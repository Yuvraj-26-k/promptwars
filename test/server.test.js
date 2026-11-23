import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAppServer } from '../server.js';

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

test('city search normalizes the Open-Meteo result', async () => {
  let upstream;
  const server = createAppServer({ fetchImpl: async (url) => {
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
  const server = createAppServer({ fetchImpl: async (url) => {
    upstream = url;
    return Response.json({
      timezone: 'Asia/Kolkata',
      current: { time: now, us_aqi: 189, pm2_5: 95.4 },
      hourly: { time: [now, next], us_aqi: [189, 171], pm2_5: [95.4, null] },
    });
  } });

  const result = await request(server, '/api/air?lat=28.61&lon=77.23');
  assert.equal(result.status, 200);
  assert.equal(upstream.origin, 'https://air-quality-api.open-meteo.com');
  assert.equal(upstream.searchParams.get('hourly'), 'us_aqi,pm2_5');
  assert.equal(upstream.searchParams.get('forecast_hours'), '24');
  assert.deepEqual(result.body, {
    aqi: 189, pm25: 95.4, time: now, timezone: 'Asia/Kolkata', source: 'Open-Meteo',
    forecast: [{ time: now, aqi: 189, pm25: 95.4 }, { time: next, aqi: 171, pm25: null }],
  });
});

test('invalid API parameters are rejected before calling a provider', async () => {
  let calls = 0;
  const server = createAppServer({ fetchImpl: async () => { calls += 1; } });
  assert.equal((await request(server, '/api/cities?q=x')).status, 400);
  assert.equal((await request(server, '/api/air?lat=&lon=77.23')).status, 400);
  assert.equal((await request(server, '/api/air?lat=28.61&lon=181')).status, 400);
  assert.equal((await request(server, '/api/chat', { method: 'POST', body: {} })).status, 400);
  assert.equal(calls, 0);
});

test('static routes serve the page and reject configuration, source, and traversal paths', async () => {
  const server = createAppServer({ apiKey: 'fixture-key' });
  const page = await request(server, '/', { method: 'HEAD' });
  assert.equal(page.status, 200);
  assert.match(page.headers['Content-Type'], /^text\/html/);
  assert.equal(page.body, undefined);
  for (const path of ['/.env', '/.env.example', '/server.js', '/assets/%2e%2e/.env.example']) {
    assert.equal((await request(server, path)).status, 404, path);
  }
});

test('configured chat calls the Responses API with contextual data and marks demo values', async () => {
  let upstream;
  const server = createAppServer({
    apiKey: 'fake-test-key',
    model: 'fixture-model',
    fetchImpl: async (url, options) => {
      upstream = { url, options };
      return Response.json({ output: [{
        type: 'message', content: [{ type: 'output_text', text: 'Run your HEPA purifier.' }],
      }] });
    },
  });

  const result = await request(server, '/api/chat', { method: 'POST', body: { question, profile } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { reply: 'Run your HEPA purifier.', mode: 'ai' });
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

test('chat stays available when a key is missing or when OpenAI fails', async () => {
  const failingProvider = async () => Response.json({}, { status: 503 });
  const local = createAppServer({ apiKey: '' });
  const broken = createAppServer({ apiKey: 'fixture-key', fetchImpl: failingProvider });
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
