import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, findCleanerWindow, findLowerAqiHour, forecastDecision, localReply } from '../plan.js';

test('finds the earliest lowest-AQI hour in the next six hours across midnight', () => {
  const selected = { time: '2026-01-08T22:00', aqi: 181 };
  const earlier = { time: '2026-01-09T00:00', aqi: 155 };
  const forecast = [
    { time: '2026-01-08T21:00', aqi: 90 },
    { time: '2026-01-09T04:00', aqi: 155 },
    { time: '2026-01-09T05:00', aqi: 90 },
    earlier,
  ];
  assert.equal(findLowerAqiHour(forecast, selected), earlier);
  assert.equal(findLowerAqiHour(forecast, earlier), forecast[2]);
  assert.equal(findLowerAqiHour(forecast, { ...selected, aqi: 155 }), null);
});

const delhiSample = {
  city: 'Delhi', dataMode: 'demo', household: 'family', aqi: 178,
  selectedHours: [{ time: '2026-01-08T08:00', aqi: 181 }, { time: '2026-01-08T13:00', aqi: 155 }],
};

test('an unhealthy Delhi sample comparison keeps precautions at the lower-AQI hour', () => {
  const decision = forecastDecision(delhiSample);
  assert.match(decision.summary, /Sample forecast.*lower by 26 AQI points.*Both hours are unhealthy/);
  assert.match(decision.action.description, /activities inside/);
  assert.match(localReply('Compare these hours', delhiSample), /activities inside/);
  assert.equal(forecastDecision({ ...delhiSample, dataMode: 'cached' }), null);
});

test('the built-in guide keeps forecast follow-ups and responds when the topic changes', () => {
  const forecast = localReply('What are the AQI values for those hours?', delhiSample);
  const kids = localReply('What about my kids?', delhiSample);
  const indoor = localReply('How can I improve indoor air without a purifier?', delhiSample);

  assert.match(forecast, /AQI 181.*AQI 155/);
  assert.match(kids, /Both hours are unhealthy.*\n\n.*activities inside/);
  assert.match(indoor, /Skip candles, incense, and indoor smoking/);
  assert.doesNotMatch(indoor, /Sample forecast/);
});

test('school pickup by car gives an everyday fuel and exhaust reduction', () => {
  const { actions: [routine] } = buildPlan({ city: 'Delhi', aqi: 180, household: 'family', commute: 'car', habits: ['school'] });
  assert.match(routine.description, /engine off while safely parked/i);
  assert.match(routine.impact, /cuts fuel use and exhaust/i);
});

const delhi = { city: 'Delhi, India', aqi: 250, pm25: 180, commute: 'car' };

test('very unhealthy air changes the advice for sensitive households', () => {
  const sensitive = buildPlan({ ...delhi, household: 'sensitive' });
  const individual = buildPlan({ ...delhi, household: 'individual' });

  assert.match(sensitive.summary, /250 \(Very unhealthy\)/);
  assert.match(sensitive.actions[0].description, /skip outdoor exercise/i);
  assert.match(individual.actions[0].description, /move demanding activities/i);
  assert.match(sensitive.actions[1].description, /keep windows closed/i);
});

test('hazardous air prompts community organizers to change group activities', () => {
  const plan = buildPlan({ ...delhi, aqi: 301, household: 'community' });

  assert.match(plan.summary, /301 \(Hazardous\)/);
  assert.match(plan.actions[0].description, /move group activities.*or postpone/i);
  assert.match(plan.actions[0].description, /share local air-quality alerts/i);
});

test('missing AQI stays unknown and demo readings are labeled as sample conditions', () => {
  const unknown = buildPlan({ city: 'Pune', aqi: null, pm25: null, dataMode: 'unavailable' });
  const demo = buildPlan({ ...delhi, dataMode: 'demo' });

  assert.match(unknown.summary, /AQI for Pune is unavailable/);
  assert.match(unknown.actions[0].description, /check a local report/i);
  assert.match(demo.summary, /^Sample conditions for Delhi, India/);
});

test('avoided car emissions scale with round-trip distance and are separate from exposure', () => {
  const short = buildPlan({ ...delhi, distance: 5 });
  const long = buildPlan({ ...delhi, distance: 10 });

  assert.match(short.actions[2].impact, /10 km.*about 2\.5 kg of tailpipe CO₂/);
  assert.match(long.actions[2].impact, /20 km.*about 5 kg of tailpipe CO₂/);
  assert.match(long.actions[0].impact, /lower particle exposure/);
  assert.doesNotMatch(long.actions[0].impact, /CO₂|\bkg\b/);
  assert.match(long.footnote, /Exposure changes.*qualitatively/);
});

test('cycling advice shifts from tailpipe emissions to exposure when air is poor', () => {
  const poorAir = { ...delhi, commute: 'bike' };
  const cleanerAir = buildPlan({ ...poorAir, aqi: 45 });
  const poorAirReply = localReply('Can I bike at this AQI?', poorAir);

  assert.match(cleanerAir.actions[2].impact, /zero tailpipe emissions/);
  assert.match(poorAirReply, /defer optional trips/i);
  assert.match(poorAirReply, /pollution you breathe/i);
});

test('offline chat offers low-cost actions when a household has no air purifier', () => {
  const reply = localReply('How can I improve indoor air without a purifier?', delhi);

  assert.match(reply, /candles|incense/i);
  assert.match(reply, /windows/i);
  assert.doesNotMatch(reply, /\b(choose|look for|purchase|buy)\b[^.!?]*\b(purifier|HEPA|filter)\b/i);
});

test('forecast window uses contiguous future hours and can cross midnight', () => {
  const forecast = [
    { time: '2026-11-23T21:00', aqi: 10 },
    { time: '2026-11-23T22:00', aqi: 20 },
    { time: '2026-11-23T23:00', aqi: 106 },
    { time: '2026-11-24T00:00', aqi: 119 },
    { time: '2026-11-24T01:00', aqi: 115 },
    { time: '2026-11-24T02:00', aqi: 149 },
    { time: '2026-11-24T04:00', aqi: 70 },
  ];

  assert.deepEqual(findCleanerWindow(forecast, '2026-11-23T22:15'), {
    start: '2026-11-23T23:00', end: '2026-11-24T02:00', minAqi: 106, maxAqi: 119,
  });
});

test('gaps, invalid hours, duplicate readings and unhealthy forecasts do not create a window', () => {
  const forecast = [
    { time: '2026-11-23T23:00', aqi: 70 },
    { time: '2026-11-23T23:00', aqi: 250 },
    { time: '2026-11-24T00:00', aqi: 60 },
    { time: '2026-11-24T01:00', aqi: null },
    { time: '2026-11-24T02:00', aqi: 65 },
    { time: '2026-11-24T03:00', aqi: 160 },
    { time: '2026-11-24T04:00', aqi: 170 },
    { time: '2026-11-31T05:00', aqi: 15 },
    { time: '2026-11-31T06:00', aqi: 10 },
    { time: '2026-11-24T22:00', aqi: 85 },
    { time: '2026-11-24T23:00', aqi: 85 },
  ];

  assert.equal(findCleanerWindow(forecast, '2026-11-23T22:15'), null);
  assert.equal(findCleanerWindow(forecast, '2026-11-23'), null);
});

test('routine uses a meaningful forecast improvement and retains sensitive group guidance', () => {
  const time = '2026-11-23T22:15';
  const forecast = [
    { time: '2026-11-24T06:00', aqi: 110 },
    { time: '2026-11-24T07:00', aqi: 125 },
  ];
  const plan = buildPlan({ ...delhi, aqi: 170, household: 'family', dataMode: 'live', time, forecast });
  const littleChange = buildPlan({ ...delhi, aqi: 134, dataMode: 'live', time, forecast });
  const stale = buildPlan({ ...delhi, dataMode: 'cached', time, forecast });
  const sample = buildPlan({ ...delhi, dataMode: 'demo', time, forecast });

  assert.match(plan.actions[0].description, /move long or strenuous activities inside/i);
  assert.match(plan.actions[0].description, /Nov 24.*local time \(U.S. AQI 110–125\)/);
  assert.match(plan.actions[0].description, /recheck local conditions.*sensitive groups/i);
  assert.doesNotMatch(littleChange.actions[0].description, /forecast is lower/i);
  assert.match(stale.summary, /AQI.*unavailable/);
  assert.doesNotMatch(stale.actions[0].description, /forecast is lower/i);
  assert.doesNotMatch(sample.actions[0].description, /forecast is lower/i);
});

test('an unhealthy forecast keeps optional strenuous activity indoors', () => {
  const time = '2026-11-23T22:15';
  const forecast = [
    { time: '2026-11-23T23:00', aqi: 175 },
    { time: '2026-11-24T00:00', aqi: 151 },
    { time: '2026-11-24T01:00', aqi: 159 },
  ];
  const plan = buildPlan({ ...delhi, aqi: 188, household: 'community', dataMode: 'modeled', time, forecast });

  assert.equal(findCleanerWindow(forecast, time), null);
  assert.match(plan.actions[0].description, /move optional strenuous activities indoors/i);
  assert.doesNotMatch(plan.actions[0].description, /local time/i);
});

test('the offline clean air plan adapts and explains all three actions', () => {
  const profile = { ...delhi, household: 'community', distance: 10, habits: ['cooking'] };
  const plan = buildPlan(profile);
  const reply = localReply('Adapt my clean air plan for my household or community. Explain the likely impact of each choice.', profile);

  assert.match(plan.actions[1].description, /shared room smoke-free/);
  assert.match(plan.actions[1].description, /low-smoke meal/);
  for (const [index, action] of plan.actions.entries()) {
    assert.ok(reply.includes(`${index + 1}. ${action.title}`));
    assert.ok(reply.includes(action.description));
    assert.ok(reply.includes(action.impact));
  }
});
