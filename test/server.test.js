import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAppServer } from '../server.js';

function testServer(options) {
  return createAppServer({ provider: 'auto', apiKey: '', model: '', geminiApiKey: '', geminiModel: '', ...options });
}

// Exercise the actual HTTP handler without relying on loopback or upstream network access.
function request(server, url, { method = 'GET', body, headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const incoming = Object.assign(Readable.from(chunks), {
    url,
    method,
    headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers },
  });

  return new Promise((resolve) => {
    let status;
    let responseHeaders;
    server.emit('request', incoming, {
      writeHead(code, values) {
        status = code;
        responseHeaders = values;
      },
      end(data) {
        const json = responseHeaders['Content-Type'].startsWith('application/json');
        resolve({ status, headers: responseHeaders, body: json ? JSON.parse(data) : data });
      },
    });
  });
}

const question = 'How can we clean our indoor air?';
const profile = { city: 'New Delhi', aqi: 189, pm25: 95.4, household: 'family', sample: true };

test('chat limits concurrent provider calls and frees a slot after a provider failure', async () => {
  const pending = [];
  let holdProviderCalls = true;
  let signalCapacityReached;
  const capacityReached = new Promise((resolve) => { signalCapacityReached = resolve; });
  const server = testServer({
    apiKey: 'test-key',
    fetchImpl: () => {
      if (!holdProviderCalls) return Response.json(null, { status: 503 });
      return new Promise((resolve) => {
        pending.push(resolve);
        if (pending.length === 3) signalCapacityReached();
      });
    },
  });
  const ask = () => request(server, '/api/chat', { method: 'POST', body: { question, profile } });
  const inFlight = [ask(), ask(), ask()];
  await capacityReached;

  try {
    const blocked = await ask();
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /busy/);
    assert.equal(pending.length, 3);
  } finally {
    for (const resolve of pending.splice(0)) resolve(Response.json(null, { status: 503 }));
    await Promise.all(inFlight);
  }

  assert.equal((await inFlight[0]).body.mode, 'local');
  holdProviderCalls = false;
  assert.equal((await ask()).status, 200);
});

test('city search normalizes the Open-Meteo result', async () => {
  let upstream;
  const server = testServer({ fetchImpl: async (url) => {
    upstream = url;
    return Response.json({ results: [{
      name: 'New Delhi', admin1: 'Delhi', country: 'India',
      latitude: 28.61, longitude: 77.23, timezone: 'Asia/Kolkata',
    }] });
  } });

  const result = await request(server, '/api/cities?q=New%20Delhi');
  assert.equal(result.status, 200);
  assert.equal(upstream.origin, 'https://geocoding-api.open-meteo.com');
  assert.equal(upstream.searchParams.get('name'), 'New Delhi');
  assert.deepEqual(result.body.cities, [{
    name: 'New Delhi', region: 'Delhi', country: 'India',
    latitude: 28.61, longitude: 77.23, timezone: 'Asia/Kolkata',
  }]);
});

test('air quality returns modeled current conditions and hourly values in local time', async () => {
  const now = '2026-11-23T10:00';
  const next = '2026-11-23T11:00';
  let upstream;
  const server = testServer({ fetchImpl: async (url) => {
    upstream = url;
    return Response.json({
      timezone: 'Asia/Kolkata',
      current: { time: now, us_aqi: 189, pm2_5: 95.4 },
      hourly: { time: [now, '2026-11-31T11:00', next], us_aqi: [189, 999, 171], pm2_5: [95.4, null, null] },
    });
  } });

  const result = await request(server, '/api/air?lat=28.61&lon=77.23');
  assert.equal(result.status, 200);
  assert.equal(upstream.origin, 'https://air-quality-api.open-meteo.com');
  assert.equal(upstream.searchParams.get('hourly'), 'us_aqi,pm2_5');
  assert.equal(upstream.searchParams.get('forecast_hours'), '24');
  const { fetchedAt, ...air } = result.body;
  assert.equal(new Date(fetchedAt).toISOString(), fetchedAt);
  assert.deepEqual(air, {
    aqi: 189, pm25: 95.4, time: now, timezone: 'Asia/Kolkata', source: 'Open-Meteo',
    forecast: [{ time: now, aqi: 189, pm25: 95.4 }, { time: next, aqi: 171, pm25: null }],
  });
});

test('nearby requests share one air lookup and failed requests are retried', async () => {
  let calls = 0;
  const current = { time: '2026-11-23T10:00', us_aqi: 100, pm2_5: 25 };
  const server = testServer({ fetchImpl: async (url) => {
    calls += 1;
    assert.ok(['28.61', '28.62'].includes(url.searchParams.get('latitude')));
    if (calls === 2) return Response.json({}, { status: 503 });
    return Response.json({ current });
  } });

  const first = '/api/air?lat=28.611&lon=77.231';
  const nearby = '/api/air?lat=28.612&lon=77.232';
  const [one, two] = await Promise.all([request(server, first), request(server, nearby)]);
  assert.equal(one.status, 200);
  assert.deepEqual(two, one);
  assert.deepEqual(await request(server, nearby), one);
  assert.equal(calls, 1);

  const anotherLocation = '/api/air?lat=28.62&lon=77.23';
  assert.equal((await request(server, anotherLocation)).status, 502);
  assert.equal((await request(server, anotherLocation)).status, 200);
  assert.equal(calls, 3);
});

test('invalid API parameters are rejected before calling a provider', async () => {
  let calls = 0;
  const server = testServer({ fetchImpl: async () => { calls += 1; } });
  assert.equal((await request(server, '/api/cities?q=x')).status, 400);
  assert.equal((await request(server, '/api/air?lat=&lon=77.23')).status, 400);
  assert.equal((await request(server, '/api/air?lat=28.61&lon=181')).status, 400);
  assert.equal((await request(server, '/api/chat', { method: 'POST', body: {} })).status, 400);
  assert.equal(calls, 0);
});

test('static routes serve the page and reject configuration, source, and traversal paths', async () => {
  const server = testServer({ apiKey: 'fixture-key' });
  const page = await request(server, '/', { method: 'HEAD' });
  assert.equal(page.status, 200);
  assert.match(page.headers['Content-Type'], /^text\/html/);
  assert.equal(page.body, undefined);
  for (const path of ['/forecast-chart.js', '/dom.js', '/assets/clearskies-assistant.png']) {
    const asset = await request(server, path);
    assert.equal(asset.status, 200, path);
    assert.ok(asset.body.length > 0, path);
  }
  for (const path of ['/.env', '/.env.example', '/server.js', '/assets/%2e%2e/.env.example']) {
    assert.equal((await request(server, path)).status, 404, path);
  }
});

test('configured chat calls the Responses API with contextual data and marks demo values', async () => {
  let upstream;
  const server = testServer({
    apiKey: 'fake-test-key',
    model: 'fixture-model',
    geminiApiKey: 'other-fixture-key',
    fetchImpl: async (url, options) => {
      upstream = { url, options };
      return Response.json({ output: [{
        type: 'message', content: [{ type: 'output_text', text: 'Run your HEPA purifier.' }],
      }] });
    },
  });

  const result = await request(server, '/api/chat', { method: 'POST', body: { question, profile } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { reply: 'Run your HEPA purifier.', mode: 'ai', provider: 'openai' });
  assert.equal(upstream.url, 'https://api.openai.com/v1/responses');
  assert.equal(upstream.options.headers.Authorization, 'Bearer fake-test-key');
  const payload = JSON.parse(upstream.options.body);
  assert.equal(payload.model, 'fixture-model');
  assert.equal(payload.store, false);
  const context = JSON.parse(payload.input.at(-1).content);
  assert.equal(context.profile.city, 'New Delhi');
  assert.equal(context.profile.dataMode, 'demo');
  assert.equal(context.plan.actions.length, 3);
});

test('chat status exposes provider availability while preserving an explicit provider choice', async () => {
  const local = testServer();
  const gemini = testServer({ geminiApiKey: 'fixture-gemini-key' });
  const selected = testServer({ provider: 'gemini', apiKey: 'fixture-openai-key' });

  assert.deepEqual((await request(local, '/api/status')).body, {
    chat: { enabled: false, provider: null, model: null },
  });
  assert.deepEqual((await request(gemini, '/api/status')).body, {
    chat: { enabled: true, provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  });
  assert.deepEqual((await request(selected, '/api/status')).body, {
    chat: { enabled: false, provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  });
});

test('Gemini receives current model data and strips stale or illustrative forecasts', async () => {
  const current = {
    ...profile, sample: false, dataMode: 'live', time: '2026-11-23T10:30',
    forecast: [
      { time: '2026-11-23T10:00', aqi: 180 },
      { time: '2026-11-23T11:00', aqi: 171 },
      { time: '2026-11-31T11:00', aqi: 999 },
    ],
  };
  const history = [
    { role: 'user', content: 'Where should I start?' },
    { role: 'assistant', content: 'Check the air where you are.' },
  ];
  const contexts = [];
  const server = testServer({
    provider: 'gemini',
    apiKey: 'ignored-openai-fixture',
    geminiApiKey: 'fixture-gemini-key',
    geminiModel: 'models/fixture-gemini-model',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/fixture-gemini-model:generateContent');
      assert.equal(options.headers['x-goog-api-key'], 'fixture-gemini-key');
      assert.equal(options.redirect, 'error');
      const payload = JSON.parse(options.body);
      assert.match(payload.systemInstruction.parts[0].text, /modeled/);
      assert.match(payload.systemInstruction.parts[0].text, /everyday words.*example readings/s);
      assert.deepEqual(payload.contents.map(({ role }) => role), ['user', 'model', 'user']);
      contexts.push(JSON.parse(payload.contents.at(-1).parts[0].text));
      return Response.json({ candidates: [{ content: { parts: [
        { thought: true, text: 'Temporary reasoning' }, { text: 'Clean indoor air is a good priority.' },
      ] } }] });
    },
  });

  for (const dataMode of ['live', 'cached', 'demo']) {
    const result = await request(server, '/api/chat', {
      method: 'POST', body: {
        question,
        profile: { ...current, dataMode, selectedForecastTimes: ['2026-11-23T10:00', '2026-11-23T11:00'] },
        history,
      },
    });
    assert.deepEqual(result.body, { reply: 'Clean indoor air is a good priority.', mode: 'ai', provider: 'gemini' });
  }
  const [live, cached, demo] = contexts.map(({ profile }) => profile);
  assert.equal(live.dataMode, 'modeled');
  assert.equal(live.time, current.time);
  assert.deepEqual(live.forecast, current.forecast.slice(0, 2));
  assert.deepEqual(live.selectedHours, live.forecast);
  assert.match(contexts[0].forecastDecision.summary, /Estimated forecast.*AQI 180.*AQI 171.*lower by 9/);
  assert.equal(cached.dataMode, 'cached');
  assert.equal(cached.aqi, null);
  assert.equal(cached.pm25, null);
  assert.deepEqual(cached.forecast, []);
  assert.equal(cached.selectedHours, undefined);
  assert.equal(contexts[1].forecastDecision, undefined);
  assert.equal(demo.dataMode, 'demo');
  assert.deepEqual(demo.forecast, []);
  assert.deepEqual(demo.selectedHours, live.selectedHours);
  assert.match(contexts[2].forecastDecision.summary, /Sample forecast.*AQI 171/);
});

test('chat stays available when a key is missing or when OpenAI fails', async () => {
  const failingProvider = async () => Response.json({}, { status: 503 });
  const local = testServer();
  const broken = testServer({ apiKey: 'fixture-key', fetchImpl: failingProvider });
  const options = { method: 'POST', body: { question, profile } };
  const offline = await request(local, '/api/chat', options);
  const fallback = await request(broken, '/api/chat', options);

  assert.equal(offline.status, 200);
  assert.equal(offline.body.mode, 'local');
  assert.equal(offline.body.reason, 'not_configured');
  assert.match(offline.body.reply, /filter|purifier/i);
  assert.deepEqual(fallback.body, { ...offline.body, reason: 'provider_unavailable' });
  assert.equal((await request(broken, '/api/air?lat=28.61&lon=77.23')).status, 502);
});
