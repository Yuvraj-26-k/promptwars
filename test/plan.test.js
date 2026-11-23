import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, localReply } from '../plan.js';

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
