import { buildPlan, findCleanerWindow, findLowerAqiHour, forecastDecision, localReply } from './plan.js';

const cities = [
  { name: 'Delhi', region: 'Delhi', country: 'India', latitude: 28.61, longitude: 77.23, timezone: 'Asia/Kolkata' },
  { name: 'Mumbai', region: 'Maharashtra', country: 'India', latitude: 19.08, longitude: 72.88, timezone: 'Asia/Kolkata' },
  { name: 'Bengaluru', region: 'Karnataka', country: 'India', latitude: 12.97, longitude: 77.59, timezone: 'Asia/Kolkata' },
  { name: 'Kolkata', region: 'West Bengal', country: 'India', latitude: 22.57, longitude: 88.36, timezone: 'Asia/Kolkata' },
  { name: 'Lucknow', region: 'Uttar Pradesh', country: 'India', latitude: 26.85, longitude: 80.95, timezone: 'Asia/Kolkata' },
  { name: 'Lahore', region: 'Punjab', country: 'Pakistan', latitude: 31.55, longitude: 74.34, timezone: 'Asia/Karachi' },
  { name: 'Dhaka', region: 'Dhaka', country: 'Bangladesh', latitude: 23.81, longitude: 90.41, timezone: 'Asia/Dhaka' },
  { name: 'Beijing', region: 'Beijing', country: 'China', latitude: 39.90, longitude: 116.41, timezone: 'Asia/Shanghai' },
  { name: 'London', region: 'England', country: 'United Kingdom', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London' },
  { name: 'Los Angeles', region: 'California', country: 'United States', latitude: 34.05, longitude: -118.24, timezone: 'America/Los_Angeles' },
  { name: 'New York', region: 'New York', country: 'United States', latitude: 40.71, longitude: -74.01, timezone: 'America/New_York' },
];

const aqiLevels = [
  { max: 50, name: 'Good', key: 'good', description: 'Outdoor air pollution presents little risk for most people at this level.' },
  { max: 100, name: 'Moderate', key: 'moderate', description: 'Air quality is acceptable for most people. People unusually sensitive to air pollution may want to take it easier outdoors.' },
  { max: 150, name: 'Unhealthy for sensitive groups', key: 'sensitive', description: 'Children, older adults, and people with heart or lung conditions should take extra care with long or strenuous outdoor activity.' },
  { max: 200, name: 'Unhealthy', key: 'unhealthy', description: 'Air pollution may affect anyone. Shorten strenuous outdoor activity and consider moving it indoors if you are in a sensitive group.' },
  { max: 300, name: 'Very unhealthy', key: 'very-unhealthy', description: 'Everyone should reduce long or strenuous activity outdoors. People in sensitive groups should move activities indoors.' },
  { max: 500, name: 'Hazardous', key: 'hazardous', description: 'Avoid outdoor exertion and follow local air-quality advisories.' },
];

const demoAqi = [178, 181, 185, 181, 173, 162, 155, 146, 139, 132, 128, 125, 129, 138, 145, 152, 167, 173, 181, 189, 194, 191, 185, 179];
const demoAir = {
  aqi: 178,
  pm25: 94,
  time: '2026-01-08T07:00',
  timezone: 'Asia/Kolkata',
  forecast: demoAqi.map((aqi, index) => ({
    time: new Date(Date.UTC(2026, 0, 8, 7 + index)).toISOString().slice(0, 16),
    aqi,
  })),
};

const householdOptions = ['family', 'sensitive', 'community', 'individual'];
const commuteOptions = ['car', 'transit', 'walk', 'bike', 'remote'];
const habitOptions = ['cooking', 'purifier', 'school', 'outdoor'];
const preferencesKey = 'airsafe.preferences.v1';
const airCacheKey = 'clearskies.last-air.v1';
const refreshInterval = 10 * 60 * 1000;
const recentEstimateAge = 2 * 60 * 60 * 1000;
const snapshotAge = 6 * 60 * 60 * 1000;

const get = (id) => document.getElementById(id);
const planner = get('planner-form');
const locationDialog = get('location-dialog');
const citySearch = get('city-search');
const chatDialog = get('chat-dialog');
const chatQuestion = get('chat-question');
const chatMessages = get('chat-messages');
const chatMode = get('chat-mode');
const chatForm = get('chat-form');
const chatGreeting = chatMessages?.firstElementChild;

const saved = readPreferences();
let rememberedCity = isCity(saved.city) ? saved.city : cities[0];
let liveLocation = rememberedCity;
let city = liveLocation;
let settings = normalizeSettings(saved.settings);
let air = null;
let airMode = 'unavailable';
let airLocation;
let lastAirAttempt = 0;
let latestPlan;
let forecastSelection;
let airRequest;
let cityRequest;
let cityTimer;
let toastTimer;
let geolocationAttempt = 0;
let chatRequest;
let chatPlace;
let chatStatus;
let chatStatusRequest;
const conversation = [];

function readPreferences() {
  try {
    const value = JSON.parse(window.localStorage.getItem(preferencesKey));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function savePreferences() {
  try {
    window.localStorage.setItem(preferencesKey, JSON.stringify({ city: rememberedCity, settings }));
  } catch {
    // The dashboard remains usable without persistent storage.
  }
}

function isCity(value) {
  return value && typeof value.name === 'string' && value.name.trim() &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

function normalizeSettings(value) {
  const input = value || {};
  const distance = input.distance === '' || input.distance == null ? 8 : Number(input.distance);
  return {
    household: householdOptions.includes(input.household) ? input.household : 'family',
    commute: commuteOptions.includes(input.commute) ? input.commute : 'car',
    distance: Number.isFinite(distance) ? Math.max(0, Math.min(distance, 100)) : 8,
    habits: Array.isArray(input.habits) ? input.habits.filter((habit) => habitOptions.includes(habit)) : [],
  };
}

function displayCity(place = city) {
  return [place.name, place.country].filter(Boolean).join(', ');
}

function profile(place = city, reading = air, mode = airMode) {
  const usableAir = ['live', 'demo'].includes(mode) ? reading : null;
  return {
    ...settings,
    city: displayCity(place),
    aqi: usableAir ? Math.round(usableAir.aqi) : null,
    pm25: Number.isFinite(usableAir?.pm25) ? usableAir.pm25 : null,
    dataMode: mode,
    time: mode === 'live' ? reading.time : undefined,
    forecast: mode === 'live' ? reading.forecast : [],
  };
}

function modelTimeAtLocation(data, date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: data.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Date.parse(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}Z`);
}

function isFreshAir(data) {
  if (!data.timezone || Date.now() - Date.parse(data.fetchedAt) > recentEstimateAge) return false;
  try {
    const age = modelTimeAtLocation(data, new Date()) - Date.parse(`${data.time}Z`);
    return age >= -15 * 60 * 1000 && age <= recentEstimateAge;
  } catch {
    return false;
  }
}

function validAir(data) {
  return Number.isFinite(data?.aqi) && data.aqi >= 0 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.time) && Number.isFinite(Date.parse(`${data.time}Z`));
}

function recentSnapshot(data) {
  const age = Date.now() - Date.parse(data?.fetchedAt);
  return validAir(data) && age >= -5 * 60 * 1000 && age <= snapshotAge;
}

function locationKey(place) {
  return `${place.latitude},${place.longitude}`;
}

function readSnapshot(place) {
  if (place.deviceLocation) return null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(airCacheKey));
    return saved?.location === locationKey(place) && recentSnapshot(saved.data) ? saved.data : null;
  } catch {
    return null;
  }
}

function saveSnapshot(place, data) {
  if (place.deviceLocation) return;
  try {
    window.sessionStorage.setItem(airCacheKey, JSON.stringify({ location: locationKey(place), data }));
  } catch {
    // The current reading remains available without storage access.
  }
}

function setText(id, value) {
  const element = get(id);
  if (element) element.textContent = value;
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgElement(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function icon(name) {
  const svg = svgElement('svg', {
    width: '22', height: '22', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  svg.append(svgElement('use', { href: `#icon-${name}` }));
  return svg;
}

function relativeAqiPosition(aqi) {
  const levelIndex = aqiLevels.findIndex((level) => aqi <= level.max);
  if (levelIndex < 0) return 100;
  const lower = aqiLevels[levelIndex - 1]?.max || 0;
  const upper = aqiLevels[levelIndex].max;
  return ((levelIndex + Math.max(0, (aqi - lower) / (upper - lower))) / aqiLevels.length) * 100;
}

function localClock(time, showDate = false, showMinutes = showDate) {
  if (typeof time !== 'string' || !time) return '';
  const localTime = new Date(`${time.slice(0, 16)}:00Z`);
  if (!Number.isFinite(localTime.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    ...(showDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    ...(showMinutes ? { minute: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(localTime);
}

function aqiCategory(aqi) {
  return aqiLevels.find((level) => aqi <= level.max) || aqiLevels.at(-1);
}

function renderAir(loading = false) {
  const aqi = air ? Math.round(air.aqi) : null;
  const pm25 = Number.isFinite(air?.pm25) ? air.pm25 : null;
  const category = aqi === null ? null : aqiCategory(aqi);
  const label = get('aqi-label');
  const marker = get('aqi-marker');

  setText('current-city', displayCity());
  setText('aqi-value', aqi === null ? '—' : aqi);
  setText('pm25-value', pm25 === null ? '—' : Number(pm25.toFixed(1)));
  setText('aqi-label', category?.name || (loading ? 'Checking air quality' : 'Unavailable'));
  if (label) label.dataset.level = category?.key || 'unavailable';
  if (marker) {
    marker.hidden = aqi === null;
    if (aqi !== null) marker.style.left = `${relativeAqiPosition(aqi)}%`;
  }

  const source = get('air-source');
  if (source) source.dataset.mode = airMode;
  if (airMode === 'live' || airMode === 'cached') {
    const updated = localClock(air.time, true);
    setText('air-source', airMode === 'live' ? 'Model estimate · Open-Meteo' : 'Last available estimate');
    setText('air-updated', updated ? `${updated} local time` : 'Open-Meteo model estimate');
    setText('air-description', airMode === 'live' ? category.description : 'This reading may be out of date. Check local advisories before heading out.');
  } else if (airMode === 'demo') {
    setText('air-source', 'Delhi sample');
    setText('air-updated', 'Illustrative conditions');
    setText('air-description', category.description);
  } else {
    setText('air-source', loading ? 'Checking live data' : 'No live data');
    setText('air-updated', '');
    setText('air-description', loading
      ? 'Looking up current conditions for this location.'
      : 'Current conditions are unavailable. Check your local air-quality advisory before making outdoor plans.');
  }
  renderAirFeedback(loading);
  renderForecast(loading);
}

function renderAirFeedback(loading) {
  const feedback = get('air-feedback');
  const retry = get('air-retry');
  const refresh = get('refresh-air');
  const sample = airMode === 'demo';
  if (refresh) {
    refresh.disabled = loading;
    refresh.setAttribute('aria-busy', String(loading));
    setText('refresh-label', loading ? 'Refreshing…' : sample ? 'Return to live' : 'Refresh air');
  }

  let message = '';
  if (sample) message = 'You’re viewing a sample scenario. Return to live for estimates at your selected location.';
  if (airMode === 'cached') message = loading
    ? 'Checking for a fresh estimate. The value shown is an earlier reading.'
    : 'A current estimate is unavailable. Your plan uses general guidance until fresh data returns.';
  if (airMode === 'unavailable' && !loading) message = 'Live estimates are unavailable. Try again or choose another location.';
  if (feedback) feedback.hidden = !message;
  setText('air-feedback-text', message);
  if (retry) {
    retry.hidden = loading;
    retry.textContent = sample ? 'Return to live' : 'Try again';
  }
  setText('demo-toggle', sample ? 'Return to live air data' : 'Try Delhi sample');
}

function renderForecast(loading) {
  const container = get('forecast-chart');
  if (!container) return;
  const focusedControl = container.contains(document.activeElement)
    ? document.activeElement.dataset.forecastControl : undefined;
  const forecastKey = `${locationKey(city)}:${airMode}`;
  const previousSelection = forecastSelection?.key === forecastKey ? forecastSelection : null;
  const selectedTime = previousSelection?.selected?.time;
  let pinnedTime = previousSelection?.reference?.time;
  forecastSelection = undefined;
  container.replaceChildren();
  const points = (airMode !== 'cached' && Array.isArray(air?.forecast) ? air.forecast : [])
    .filter((point) => point && Number.isFinite(point.aqi) && typeof point.time === 'string').slice(0, 24);
  if (points.length < 2) {
    const status = makeElement('div', 'forecast-empty', loading ? 'Loading forecast…' : 'Forecast unavailable');
    status.setAttribute('role', 'status');
    container.append(status);
    setText('forecast-note', airMode === 'cached' && !loading ? 'A fresh estimate is needed for forecast guidance.' : '');
    return;
  }

  const width = 360;
  const height = 105;
  const start = 28;
  const end = width - 6;
  const top = 9;
  const bottom = height - 9;
  const values = points.map(({ aqi }) => aqi);
  if (!points.some((point) => point.time === pinnedTime)) pinnedTime = undefined;
  const min = Math.max(0, Math.floor((Math.min(...values) - 10) / 20) * 20);
  const max = Math.max(min + 40, Math.ceil((Math.max(...values) + 10) / 20) * 20);
  const xAt = (index) => start + index / (points.length - 1) * (end - start);
  const yAt = (value) => bottom - (value - min) / (max - min) * (bottom - top);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index)} ${yAt(point.aqi)}`).join(' ');

  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img',
    'aria-label': `${airMode === 'demo' ? 'Sample' : 'Estimated'} U.S. AQI over the next ${points.length} hours, ranging from ${Math.round(Math.min(...values))} to ${Math.round(Math.max(...values))}.`,
  });
  const gradient = svgElement('linearGradient', { id: 'forecast-gradient', x1: '0', x2: '0', y1: '0', y2: '1' });
  gradient.append(svgElement('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': '.28' }));
  gradient.append(svgElement('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': '.01' }));
  const defs = svgElement('defs', {});
  defs.append(gradient);
  svg.append(defs);

  for (const value of [max, (min + max) / 2, min]) {
    const y = yAt(value);
    svg.append(svgElement('path', { d: `M ${start} ${y} H ${end}`, class: 'forecast-grid', stroke: 'currentColor', opacity: '.15' }));
    const tick = svgElement('text', { x: '0', y: y + 3, class: 'forecast-axis', fill: 'currentColor', 'font-size': '9' });
    tick.textContent = String(value);
    svg.append(tick);
  }

  svg.append(svgElement('path', { d: `${path} L ${end} ${bottom} H ${start} Z`, class: 'forecast-fill', fill: 'url(#forecast-gradient)' }));
  svg.append(svgElement('path', { d: path, class: 'forecast-line', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.25', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const guide = svgElement('line', { y1: top, y2: bottom, class: 'forecast-guide' });
  const marker = svgElement('circle', { r: '4', class: 'forecast-dot', fill: 'currentColor' });
  const pinnedMarker = svgElement('circle', { r: '4', class: 'forecast-pinned-dot', fill: 'currentColor' });
  svg.append(guide, marker, pinnedMarker);
  svg.classList.add('forecast-interactive');
  container.append(svg);

  const times = makeElement('div', 'forecast-times');
  const step = (points.length - 1) / 3;
  const indices = [...new Set([0, Math.round(step), Math.round(step * 2), points.length - 1])];
  for (const index of indices) times.append(makeElement('span', '', localClock(points[index].time)));
  container.append(times);

  const explorer = makeElement('div', 'forecast-explorer');
  const detail = makeElement('p', 'forecast-detail');
  const control = makeElement('input', 'forecast-slider');
  control.type = 'range';
  control.min = '0';
  control.max = String(points.length - 1);
  control.setAttribute('aria-label', 'Explore forecast by hour');
  const buttons = makeElement('div', 'forecast-actions');
  const pin = makeElement('button', 'button button-secondary', 'Pin this hour');
  const findHour = makeElement('button', 'button button-secondary', 'Find a lower-AQI hour');
  const askHour = makeElement('button', 'button button-assistant', 'Ask about this hour');
  control.dataset.forecastControl = 'slider';
  pin.dataset.forecastControl = 'pin';
  findHour.dataset.forecastControl = 'find';
  askHour.dataset.forecastControl = 'ask';
  pin.type = findHour.type = askHour.type = 'button';
  askHour.setAttribute('aria-haspopup', 'dialog');
  const comparison = makeElement('p', 'forecast-comparison');
  const searchResult = makeElement('p', 'forecast-comparison');
  searchResult.setAttribute('role', 'status');
  buttons.append(pin, findHour, askHour);
  explorer.append(detail, control, buttons, searchResult, comparison);
  container.append(explorer);

  function selectHour(index) {
    const point = points[index];
    if (control.value !== String(index)) searchResult.textContent = '';
    const x = xAt(index);
    const label = localClock(point.time, true, true) + ' local time';
    const aqi = Math.round(point.aqi);
    const text = (airMode === 'demo' ? 'Sample' : 'Estimated') + ' AQI ' + aqi + ' · ' + aqiCategory(aqi).name;
    control.value = String(index);
    control.setAttribute('aria-valuetext', label + ' · ' + text);
    guide.setAttribute('x1', x);
    guide.setAttribute('x2', x);
    marker.setAttribute('cx', x);
    marker.setAttribute('cy', yAt(point.aqi));
    detail.textContent = label + ' · ' + text;
    const pinnedIndex = points.findIndex(({ time }) => time === pinnedTime);
    const pinned = points[pinnedIndex];
    forecastSelection = { key: forecastKey, selected: point, reference: pinned };
    pinnedMarker.setAttribute('visibility', pinned ? 'visible' : 'hidden');
    if (pinned) {
      pinnedMarker.setAttribute('cx', xAt(pinnedIndex));
      pinnedMarker.setAttribute('cy', yAt(pinned.aqi));
    }
    pin.textContent = pinned ? 'Clear pinned hour' : 'Pin this hour';
    askHour.textContent = pinned && pinned !== point ? 'Ask about these hours' : 'Ask about this hour';
    const decision = pinned && pinned !== point ? forecastDecision(forecastProfile()) : null;
    comparison.textContent = decision
      ? `${decision.summary} ${decision.action.description} ${decision.action.impact}`
      : pinned ? 'Choose another hour to compare.' : '';
  }

  function selectFromPointer(event) {
    const transform = svg.getScreenCTM();
    if (!transform || !transform.a) return;
    const x = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse()).x;
    const index = Math.round((x - start) / (end - start) * (points.length - 1));
    selectHour(Math.max(0, Math.min(points.length - 1, index)));
  }

  control.addEventListener('input', () => selectHour(Number(control.value)));
  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse' && document.activeElement !== control) selectFromPointer(event);
  });
  svg.addEventListener('click', selectFromPointer);
  pin.addEventListener('click', () => {
    pinnedTime = pinnedTime ? undefined : points[Number(control.value)].time;
    selectHour(Number(control.value));
  });
  findHour.addEventListener('click', () => {
    const selected = points[Number(control.value)];
    const lowerHour = findLowerAqiHour(points, selected);
    if (!lowerHour) {
      searchResult.textContent = 'No lower AQI is shown in the next six hours of this forecast.';
      return;
    }
    pinnedTime = selected.time;
    selectHour(points.indexOf(lowerHour));
    searchResult.textContent = `Found a lower AQI at ${localClock(lowerHour.time, true, true)} local time.`;
  });
  askHour.addEventListener('click', () => {
    const context = forecastProfile();
    showDialog(chatDialog, chatQuestion);
    void ask(context.selectedHours.length > 1
      ? 'Compare these two forecast hours for my outdoor plans. What would you suggest?'
      : 'What does this selected forecast hour mean for my outdoor plans?', context);
  });
  selectHour(Math.max(0, points.findIndex((point) => point.time === selectedTime)));
  const focusTarget = [control, pin, findHour, askHour].find((element) => element.dataset.forecastControl === focusedControl);
  focusTarget?.focus({ preventScroll: true });

  const range = `${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))}`;
  if (airMode === 'demo') {
    setText('forecast-note', `Sample forecast · AQI ${range}`);
  } else {
    const window = findCleanerWindow(points, air.time);
    if (window && window.maxAqi + 15 <= air.aqi) {
      const start = localClock(window.start, window.start.slice(0, 10) !== air.time.slice(0, 10), false);
      const end = localClock(window.end, window.end.slice(0, 10) !== window.start.slice(0, 10), false);
      setText('forecast-note', `Lower-AQI window · ${start} to ${end} local time · up to ${Math.round(window.maxAqi)}`);
    } else if (values.every((value) => value >= 151)) {
      setText('forecast-note', 'The forecast stays at unhealthy levels.');
    } else {
      setText('forecast-note', `Forecast AQI ${range} · all times local`);
    }
  }
}

function forecastProfile() {
  const context = profile();
  const { selected, reference } = forecastSelection;
  const selectedHours = (reference && reference !== selected ? [selected, reference] : [selected])
    .map(({ time, aqi }) => ({ time, aqi: Math.round(aqi) }));
  return {
    ...context,
    time: air.time,
    forecast: air.forecast,
    selectedHours,
    selectedForecastTimes: selectedHours.map(({ time }) => time),
  };
}

function renderPlan() {
  latestPlan = buildPlan(profile());
  setText('plan-headline', latestPlan.headline);
  setText('plan-summary', latestPlan.summary);
  setText('plan-footnote', latestPlan.footnote);
  const actions = get('plan-actions');
  if (!actions) return;
  const cards = latestPlan.actions.map((action) => {
    const card = makeElement('article', 'plan-card');
    const iconBox = makeElement('div', 'plan-card-icon');
    iconBox.append(icon(action.icon));
    const impact = makeElement('p', 'plan-card-impact');
    impact.append(makeElement('span', 'plan-card-impact-label', 'Impact'), document.createTextNode(action.impact));
    card.append(
      iconBox,
      makeElement('p', 'plan-card-category', action.category),
      makeElement('h3', '', action.title),
      makeElement('p', 'plan-card-description', action.description),
      impact,
    );
    return card;
  });
  actions.replaceChildren(...cards);
}

function initializeForm() {
  if (!planner) return;
  for (const name of ['household', 'commute', 'distance']) {
    const field = planner.elements.namedItem(name);
    if (field) field.value = settings[name];
  }
  for (const control of planner.querySelectorAll('[name="habits"]')) {
    control.checked = settings.habits.includes(control.value);
  }
  planner.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(planner);
    settings = normalizeSettings({
      household: form.get('household'),
      commute: form.get('commute'),
      distance: form.get('distance'),
      habits: form.getAll('habits'),
    });
    savePreferences();
    renderPlan();
    showToast('Your clean-air plan is updated.');
  });
}

async function api(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const requestSignal = options.signal;
  const abort = () => controller.abort();
  if (requestSignal?.aborted) abort();
  requestSignal?.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error('The request failed.');
    return await response.json();
  } finally {
    window.clearTimeout(timer);
    requestSignal?.removeEventListener('abort', abort);
  }
}

async function loadAir() {
  airRequest?.abort();
  const request = new AbortController();
  airRequest = request;
  lastAirAttempt = Date.now();

  const selectedCity = city;
  const prior = airLocation === selectedCity && recentSnapshot(air) ? air : readSnapshot(selectedCity);
  const stillLive = airMode === 'live' && prior === air && air && isFreshAir(air);
  air = prior;
  airMode = stillLive ? 'live' : prior ? 'cached' : 'unavailable';
  airLocation = selectedCity;
  renderAir(true);
  renderPlan();

  const query = new URLSearchParams({ lat: selectedCity.latitude, lon: selectedCity.longitude });
  try {
    const data = await api(`/api/air?${query}`, { signal: request.signal });
    if (request.signal.aborted) return;
    if (!validAir(data)) throw new Error('Air-quality data is unavailable.');
    const fetchedAt = Number.isFinite(Date.parse(data.fetchedAt)) ? data.fetchedAt : new Date().toISOString();
    const reading = { ...data, fetchedAt };
    if (!recentSnapshot(reading)) throw new Error('Air-quality data is out of date.');
    air = reading;
    airMode = isFreshAir(reading) ? 'live' : 'cached';
    saveSnapshot(selectedCity, reading);
  } catch {
    if (request.signal.aborted) return;
    air = recentSnapshot(prior) ? prior : null;
    airMode = air ? 'cached' : 'unavailable';
  } finally {
    if (airRequest === request) airRequest = undefined;
  }
  renderAir();
  renderPlan();
}

function refreshAir() {
  if (airMode === 'demo') {
    city = liveLocation;
    resetChat();
  }
  return loadAir();
}

function initializeAirRefresh() {
  for (const id of ['refresh-air', 'air-retry']) {
    get(id)?.addEventListener('click', () => void refreshAir());
  }
  function refreshIfDue() {
    if (!document.hidden && !airRequest && airMode !== 'demo' && Date.now() - lastAirAttempt >= refreshInterval) {
      void loadAir();
    }
  }
  document.addEventListener('visibilitychange', refreshIfDue);
  window.addEventListener('online', () => {
    if (!document.hidden && !airRequest && airMode !== 'demo') void loadAir();
  });
  window.setInterval(refreshIfDue, refreshInterval);
}

function showDialog(dialog, control) {
  if (dialog && !dialog.open) dialog.showModal();
  control?.focus();
}

function useCity(place) {
  if (!isCity(place)) return;
  city = place;
  liveLocation = place;
  if (!place.deviceLocation) {
    rememberedCity = place;
    savePreferences();
  }
  resetChat();
  locationDialog?.close();
  void loadAir();
  showToast(`Location set to ${displayCity()}.`);
}

function toggleSample() {
  locationDialog?.close();
  if (airMode === 'demo') {
    void refreshAir();
    return;
  }
  airRequest?.abort();
  airRequest = undefined;
  city = cities[0];
  airLocation = undefined;
  air = demoAir;
  airMode = 'demo';
  resetChat();
  renderAir();
  renderPlan();
}

function useDeviceLocation() {
  const button = get('use-location');
  if (!navigator.geolocation) {
    setText('location-status', 'Device location is unavailable here. Search for a nearby city.');
    return;
  }

  const attempt = ++geolocationAttempt;
  cityRequest?.abort();
  window.clearTimeout(cityTimer);
  if (button) button.disabled = true;
  setText('location-status', 'Waiting for location permission…');

  function acceptResult() {
    if (attempt !== geolocationAttempt || !locationDialog?.open) return false;
    if (button) button.disabled = false;
    return true;
  }

  navigator.geolocation.getCurrentPosition(({ coords }) => {
    if (!acceptResult()) return;
    useCity({
      name: 'Near your location',
      latitude: Number(coords.latitude.toFixed(2)),
      longitude: Number(coords.longitude.toFixed(2)),
      deviceLocation: true,
    });
  }, (error) => {
    if (!acceptResult()) return;
    setText('location-status', error.code === 1
      ? 'Location permission was denied. Search for a city instead.'
      : 'Could not get your location. Try again or search for a city.');
  }, { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10000 });
}

function localCities(query) {
  const normalized = query.trim().toLowerCase();
  return cities.filter((place) => [place.name, place.region, place.country]
    .some((part) => part.toLowerCase().includes(normalized))).slice(0, 7);
}

function renderCities(matches) {
  const container = get('city-results');
  if (!container) return;
  const buttons = matches.filter(isCity).map((place) => {
    const button = makeElement('button', 'city-result');
    button.type = 'button';
    const details = [...new Set([place.region, place.country])].filter((part) => part && part !== place.name);
    button.append(makeElement('span', 'city-result-name', place.name), makeElement('span', 'city-result-meta', details.join(', ')));
    button.addEventListener('click', () => useCity(place));
    return button;
  });
  container.replaceChildren(...buttons);
}

async function searchCities(query) {
  const request = new AbortController();
  cityRequest = request;
  const local = localCities(query);
  renderCities(local);
  setText('location-status', 'Searching for cities…');
  try {
    const search = new URLSearchParams({ q: query });
    const data = await api(`/api/cities?${search}`, { signal: request.signal }, 7000);
    if (request.signal.aborted) return;
    const matches = (Array.isArray(data?.cities) ? data.cities : []).filter(isCity);
    const results = matches.length ? matches : local;
    renderCities(results);
    setText('location-status', results.length ? '' : 'No cities found. Try a nearby city or a different spelling.');
  } catch {
    if (request.signal.aborted) return;
    setText('location-status', local.length ? 'Showing available offline cities.' : 'City search is unavailable. Try one of the suggested cities.');
  }
}

function queueCitySearch() {
  const query = citySearch?.value.trim() || '';
  cityRequest?.abort();
  window.clearTimeout(cityTimer);
  renderCities([]);
  if (query.length < 2) {
    setText('location-status', query ? 'Enter at least two characters.' : '');
    return;
  }
  setText('location-status', 'Searching for cities…');
  cityTimer = window.setTimeout(() => void searchCities(query), 240);
}

function initializeLocation() {
  get('location-button')?.addEventListener('click', () => {
    showDialog(locationDialog, citySearch);
  });
  get('location-close')?.addEventListener('click', () => locationDialog?.close());
  const deviceLocation = get('use-location');
  deviceLocation?.addEventListener('click', useDeviceLocation);
  get('demo-toggle')?.addEventListener('click', toggleSample);
  locationDialog?.addEventListener('close', () => {
    geolocationAttempt++;
    if (deviceLocation) deviceLocation.disabled = false;
    cityRequest?.abort();
    window.clearTimeout(cityTimer);
    if (citySearch) citySearch.value = '';
    renderCities([]);
    setText('location-status', '');
  });
  citySearch?.addEventListener('input', queueCitySearch);
  citySearch?.closest('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const first = get('city-results')?.querySelector('button');
    if (first) first.click();
    else queueCitySearch();
  });
  document.querySelectorAll('[data-city]').forEach((button) => {
    button.addEventListener('click', () => {
      const shortcut = button.dataset.city.trim();
      const place = cities.find((candidate) => candidate.name.toLowerCase() === shortcut.toLowerCase());
      if (place) {
        useCity(place);
      } else if (citySearch) {
        showDialog(locationDialog, citySearch);
        citySearch.value = shortcut;
        queueCitySearch();
      }
    });
  });
}

function addMessage(role, text) {
  const message = makeElement('div', `chat-message chat-message--${role}`, text);
  chatMessages?.append(message);
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

const providerNames = { openai: 'OpenAI', gemini: 'Gemini', ollama: 'Local Ollama' };

function describeChatStatus() {
  if (!chatStatus) {
    setText('chat-mode', 'Checking assistant setup…');
    return;
  }

  const provider = providerNames[chatStatus.provider];
  setText('adapt-plan-label', chatStatus.enabled ? 'Ask AI to adapt plan' : 'Adapt my plan');
  setText('chat-mode', chatStatus.enabled ? `${provider} ready` : 'Built-in guide');
  setText('chat-data-note', chatStatus.enabled
    ? `Your question, recent messages, city label, and plan context are sent to ${provider}.`
    : 'The built-in guide uses your current plan. Configure a local model or an API key for generative replies.');
  if (chatMode) chatMode.dataset.mode = chatStatus.enabled ? 'ai' : 'local';
}

function loadChatStatus() {
  if (chatStatusRequest) return chatStatusRequest;
  chatStatusRequest = api('/api/status', {}, 4000).then(({ chat }) => {
    const provider = Object.hasOwn(providerNames, chat?.provider) ? chat.provider : null;
    chatStatus = { enabled: Boolean(provider && chat.enabled === true), provider };
  }).catch(() => {
    chatStatus = { enabled: false, provider: null };
  }).finally(() => {
    chatStatusRequest = undefined;
    if (!chatRequest) describeChatStatus();
  });
  return chatStatusRequest;
}

function resetChat() {
  chatRequest?.abort();
  chatRequest = undefined;
  chatPlace = undefined;
  conversation.length = 0;
  if (chatMessages) {
    chatMessages.replaceChildren(...(chatGreeting ? [chatGreeting] : []));
    chatMessages.setAttribute('aria-busy', 'false');
  }
  if (chatQuestion) chatQuestion.value = '';
  const sendButton = chatForm?.querySelector('[type="submit"]');
  if (sendButton) sendButton.disabled = false;
  describeChatStatus();
}

async function ask(questionValue, selectedContext) {
  const question = questionValue.trim().slice(0, 1000);
  if (!question || chatRequest || !chatQuestion) return;
  const request = new AbortController();
  chatRequest = request;
  const sendButton = chatForm?.querySelector('[type="submit"]');
  if (sendButton) sendButton.disabled = true;
  chatMessages?.setAttribute('aria-busy', 'true');
  chatQuestion.value = '';
  addMessage('user', question);
  const response = addMessage('assistant', 'Preparing your reply…');
  const context = selectedContext ?? await chatProfile(question, request.signal);
  if (request.signal.aborted) return;
  if (!chatStatus || chatStatusRequest) await loadChatStatus();
  if (request.signal.aborted) return;

  let result;
  if (chatStatus.enabled) {
    try {
      result = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, profile: context, history: conversation }),
        signal: request.signal,
      }, chatStatus.provider === 'ollama' ? 185000 : 60000);
    } catch {
      result = { reason: 'provider_unavailable' };
    }
  }
  if (request.signal.aborted) return;

  const answer = typeof result?.reply === 'string' && result.reply.trim() ? result.reply : localReply(question, context);
  const isAi = result?.mode === 'ai';
  renderAIResponse(response, answer);
  if (context.dataMode === 'demo') {
    response.prepend(makeElement('p', 'reply-evidence', 'Delhi sample · Example readings'));
  } else if (context.dataMode === 'live' && context.time && Number.isFinite(context.aqi)) {
    const evidence = makeElement('p', 'reply-evidence');
    evidence.textContent = `Air data for ${context.city} · ${localClock(context.time, true)} local time · US AQI ${context.aqi}`;
    if (Number.isFinite(context.pm25)) evidence.append(` · PM₂.₅ ${context.pm25} µg/m³`);
    const source = makeElement('a', '', 'Open-Meteo / CAMS model estimate');
    source.href = 'https://open-meteo.com/en/docs/air-quality-api';
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    evidence.append(document.createElement('br'), source);
    response.append(evidence);
  }
  conversation.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
  if (conversation.length > 6) conversation.splice(0, conversation.length - 6);
  chatRequest = undefined;
  if (sendButton) sendButton.disabled = false;
  if (chatMode) {
    const provider = providerNames[result?.provider] || 'AI';
    chatMode.textContent = isAi ? `AI reply · ${provider}` : result?.reason === 'provider_unavailable'
      ? 'AI unavailable · built-in guide' : 'Built-in guide';
    chatMode.dataset.mode = isAi ? 'ai' : 'local';
  }
  if (chatMessages) {
    chatMessages.setAttribute('aria-busy', 'false');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function initializeChat() {
  const launcher = get('assistant-launcher');
  const welcome = get('assistant-welcome');
  const welcomeKey = 'clearskies.assistant-welcome.v1';
  if (launcher) launcher.hidden = false;
  if (welcome) {
    try {
      welcome.hidden = window.sessionStorage.getItem(welcomeKey) === 'seen';
    } catch {
      welcome.hidden = false;
    }
  }

  function dismissWelcome() {
    if (!welcome || welcome.hidden) return;
    welcome.hidden = true;
    try {
      window.sessionStorage.setItem(welcomeKey, 'seen');
    } catch {
      // The greeting can still be dismissed when browser storage is disabled.
    }
  }

  get('assistant-welcome-close')?.addEventListener('click', () => {
    dismissWelcome();
    get('assistant-launch-button')?.focus({ preventScroll: true });
  });
  chatDialog?.addEventListener('close', dismissWelcome);

  function openChat() {
    dismissWelcome();
    showDialog(chatDialog, chatQuestion);
    void loadChatStatus();
  }
  document.querySelectorAll('[data-open-chat]').forEach((button) => {
    button.addEventListener('click', openChat);
  });
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      openChat();
      void ask(button.dataset.prompt || button.textContent);
    });
  });
  get('chat-close')?.addEventListener('click', () => chatDialog?.close());
  chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(chatQuestion?.value || '');
  });
  describeChatStatus();
  void loadChatStatus();
}

function showToast(text) {
  const toast = get('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3700);
}

function shareText() {
  const context = profile();
  const title = `Clean-air plan for ${context.city}`;
  const timestamp = airMode === 'live' ? `Open-Meteo estimate for ${localClock(air.time, true)} local time.` : '';
  const actions = latestPlan.actions.map((action) => `${action.title}\n${action.description}\n${action.impact}`);
  const decision = forecastSelection && forecastDecision(forecastProfile());
  const timing = decision && `${decision.summary}\n${decision.action.description} ${decision.action.impact}`;
  return [title, timestamp, timing, latestPlan.summary, ...actions, latestPlan.footnote].filter(Boolean).join('\n\n');
}

async function sharePlan() {
  if (!latestPlan) return;
  const text = shareText();
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Clean-air plan', text });
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Plan copied to your clipboard.');
  } catch {
    const content = makeElement('textarea');
    const previousFocus = document.activeElement;
    content.value = text;
    content.setAttribute('readonly', '');
    content.style.position = 'fixed';
    content.style.opacity = '0';
    document.body.append(content);
    content.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      // Copy support varies when the clipboard API is unavailable.
    } finally {
      content.remove();
      previousFocus?.focus();
    }
    showToast(copied ? 'Plan copied to your clipboard.' : 'This browser could not copy the plan.');
  }
}

initializeForm();
initializeLocation();
initializeAirRefresh();
initializeChat();
get('share-button')?.addEventListener('click', () => void sharePlan());
void loadAir();


function renderAIResponse(element, answer) {
  element.replaceChildren();
  element.style.whiteSpace = 'pre-wrap';

  const lines = answer.split(/\r?\n/);

  lines.forEach((line, index) => {
    line = line.replace(/^\s*[-*]\s+/, '\u2022 ');

    const parts = line.split(/(\*\*[^*]+\*\*)/g);

    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**')) {
        const bold = document.createElement('strong');
        bold.textContent = part.slice(2, -2);
        element.appendChild(bold);
      } else {
        element.appendChild(document.createTextNode(part));
      }
    }

    if (index < lines.length - 1) {
      element.appendChild(document.createTextNode('\n'));
    }
  });
}



async function chatProfile(question, signal) {
  const placeMention = /\b(?:air quality|AQI|pollution|smog)\s+in\s+([\p{L}][\p{L}'’ -]{1,59}?)(?=\s+(?:today|tomorrow|right now|this morning|this evening|for|and)\b|[?.!,]|$)/iu;
  const locationMention = /\b(?:live in|lives in|living in|located in|based in|city of|in)\s+([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,3})/;
  const requestedCity = question.match(placeMention)?.[1]?.trim();
  const name = requestedCity || question.match(locationMention)?.[1];
  const place = name ? await resolveChatPlace(name, signal) : chatPlace;
  if (signal.aborted) return;
  if (place) {
    chatPlace = place;
    return profileForChatPlace(place, signal);
  }
  if (name) {
    if (requestedCity) chatPlace = undefined;
    return requestedCity ? { ...profile(city, null, 'unavailable'), city: requestedCity } : profile();
  }
  return profile();
}

async function resolveChatPlace(name, signal) {
  const normalized = name.toLowerCase();
  const matches = (place) => isCity(place) && place.name.toLowerCase() === normalized;
  let place = [city, ...cities].find(matches);
  if (!place) {
    try {
      const query = new URLSearchParams({ q: name });
      const data = await api('/api/cities?' + query, { signal }, 4000);
      place = data.cities?.find(matches);
    } catch {
      // City lookup can be unavailable when the network is down.
    }
  }
  return place;
}

async function profileForChatPlace(place, signal) {
  if (locationKey(place) === locationKey(city) && airMode === 'live' && isFreshAir(air)) return profile();

  try {
    const query = new URLSearchParams({ lat: place.latitude, lon: place.longitude });
    const reading = await api('/api/air?' + query, { signal }, 5000);
    if (validAir(reading) && isFreshAir(reading)) return profile(place, reading, 'live');
  } catch {
    // The assistant can still provide general advice without fresh estimates.
  }
  return profile(place, null, 'unavailable');
}
