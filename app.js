import { buildPlan, localReply } from './plan.js';

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

const get = (id) => document.getElementById(id);
const planner = get('planner-form');
const locationDialog = get('location-dialog');
const citySearch = get('city-search');
const chatDialog = get('chat-dialog');
const chatQuestion = get('chat-question');
const chatMessages = get('chat-messages');
const chatMode = get('chat-mode');
const chatForm = get('chat-form');

const saved = readPreferences();
let city = isCity(saved.city) ? saved.city : cities[0];
let settings = normalizeSettings(saved.settings);
let air = null;
let airMode = 'unavailable';
let latestPlan;
let airRequest;
let cityRequest;
let cityTimer;
let toastTimer;
let chatBusy = false;
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
    window.localStorage.setItem(preferencesKey, JSON.stringify({ city, settings }));
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

function profile() {
  return {
    ...settings,
    city: displayCity(),
    aqi: Number.isFinite(air?.aqi) ? Math.round(air.aqi) : null,
    pm25: Number.isFinite(air?.pm25) ? air.pm25 : null,
    dataMode: airMode,
    forecast: airMode === 'live' ? air.forecast : [],
  };
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

function localClock(time, showDate = false) {
  if (typeof time !== 'string' || !time) return '';
  const localTime = new Date(`${time.slice(0, 16)}:00Z`);
  if (!Number.isFinite(localTime.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    ...(showDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    ...(showDate ? { minute: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(localTime);
}

function aqiCategory(aqi) {
  return aqiLevels.find((level) => aqi <= level.max) || aqiLevels.at(-1);
}

function renderAir(loading = false) {
  const { aqi, pm25 } = profile();
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
  if (airMode === 'live') {
    const updated = localClock(air.time, true);
    setText('air-source', 'Model estimate · Open-Meteo');
    setText('air-updated', updated ? `${updated} local time` : 'Current model estimate');
    setText('air-description', category.description);
  } else if (airMode === 'demo') {
    setText('air-source', 'Demo data');
    setText('air-updated', loading ? 'Checking live data' : 'Sample for Delhi');
    setText('air-description', category.description);
  } else {
    setText('air-source', loading ? 'Checking live data' : 'No live data');
    setText('air-updated', '');
    setText('air-description', loading
      ? 'Looking up current conditions for this location.'
      : 'Current conditions are unavailable. Check your local air-quality advisory before making outdoor plans.');
  }
  renderForecast(loading);
}

function renderForecast(loading) {
  const container = get('forecast-chart');
  if (!container) return;
  container.replaceChildren();
  const points = (Array.isArray(air?.forecast) ? air.forecast : [])
    .filter((point) => point && Number.isFinite(point.aqi) && typeof point.time === 'string').slice(0, 24);
  if (points.length < 2) {
    container.append(makeElement('div', 'forecast-empty', loading ? 'Loading forecast…' : 'Forecast unavailable'));
    setText('forecast-note', '');
    return;
  }

  const width = 360;
  const height = 105;
  const start = 28;
  const end = width - 6;
  const top = 9;
  const bottom = height - 9;
  const values = points.map(({ aqi }) => aqi);
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
  svg.append(svgElement('circle', { cx: start, cy: yAt(points[0].aqi), r: '3', class: 'forecast-dot', fill: 'currentColor' }));
  container.append(svg);

  const times = makeElement('div', 'forecast-times');
  const step = (points.length - 1) / 3;
  const indices = [...new Set([0, Math.round(step), Math.round(step * 2), points.length - 1])];
  for (const index of indices) times.append(makeElement('span', '', localClock(points[index].time)));
  container.append(times);

  const lowest = points.reduce((best, point) => point.aqi < best.aqi ? point : best, points[0]);
  const hour = localClock(lowest.time);
  const lowLabel = hour ? `Lowest AQI around ${hour}` : 'Hourly U.S. AQI';
  setText('forecast-note', airMode === 'demo' ? `Sample forecast · ${lowLabel}` : `${lowLabel} local time`);
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

  const selectedCity = city;
  const isDelhi = selectedCity.name.toLowerCase() === 'delhi' && Math.abs(selectedCity.latitude - 28.61) < 0.5 &&
    Math.abs(selectedCity.longitude - 77.23) < 0.5;
  airMode = isDelhi ? 'demo' : 'unavailable';
  air = isDelhi ? demoAir : null;
  renderAir(true);
  renderPlan();

  const query = new URLSearchParams({ lat: selectedCity.latitude, lon: selectedCity.longitude });
  try {
    const data = await api(`/api/air?${query}`, { signal: request.signal });
    if (request.signal.aborted) return;
    if (!Number.isFinite(data?.aqi) || data.aqi < 0) throw new Error('Air-quality data is unavailable.');
    air = data;
    airMode = 'live';
  } catch {
    if (request.signal.aborted) return;
  }
  renderAir();
  renderPlan();
}

function showDialog(dialog, control) {
  if (dialog && !dialog.open) dialog.showModal();
  control?.focus();
}

function useCity(place) {
  if (!isCity(place)) return;
  city = place;
  savePreferences();
  locationDialog?.close();
  void loadAir();
  showToast(`Location set to ${displayCity()}.`);
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
  locationDialog?.addEventListener('close', () => {
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

async function ask(questionValue) {
  const question = questionValue.trim().slice(0, 1000);
  if (!question || chatBusy || !chatQuestion) return;
  chatBusy = true;
  const sendButton = chatForm?.querySelector('[type="submit"]');
  if (sendButton) sendButton.disabled = true;
  chatMessages?.setAttribute('aria-busy', 'true');
  chatQuestion.value = '';
  addMessage('user', question);
  const response = addMessage('assistant', 'Thinking…');
  const context = profile();
  const plan = latestPlan;
  let answer;
  let mode;
  try {
    const result = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, profile: context, plan, history: conversation }),
    }, 24000);
    if (typeof result?.reply !== 'string' || !result.reply.trim()) throw new Error('No assistant reply.');
    answer = result.reply;
    mode = result.mode;
  } catch {
    answer = localReply(question, context);
    mode = 'local';
  } finally {
    chatBusy = false;
    if (sendButton) sendButton.disabled = false;
  }
  response.textContent = answer;
  conversation.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
  if (conversation.length > 6) conversation.splice(0, conversation.length - 6);
  if (chatMode) {
    chatMode.textContent = mode === 'ai' ? 'AI response' : 'Offline guide';
    chatMode.dataset.mode = mode === 'ai' ? 'ai' : 'local';
  }
  if (chatMessages) {
    chatMessages.setAttribute('aria-busy', 'false');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function initializeChat() {
  document.querySelectorAll('[data-open-chat]').forEach((button) => {
    button.addEventListener('click', () => showDialog(chatDialog, chatQuestion));
  });
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      showDialog(chatDialog, chatQuestion);
      void ask(button.dataset.prompt || button.textContent);
    });
  });
  get('chat-close')?.addEventListener('click', () => chatDialog?.close());
  chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(chatQuestion?.value || '');
  });
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
  const airStatus = context.aqi === null ? 'AQI unavailable' : `U.S. AQI ${context.aqi}${airMode === 'demo' ? ' (sample data)' : ' (model estimate)'}`;
  const title = `Clean-air plan for ${context.city}`;
  const actions = latestPlan.actions.map((action) => `${action.title}: ${action.description} Impact: ${action.impact}`);
  return [title, airStatus, latestPlan.summary, ...actions, latestPlan.footnote].filter(Boolean).join('\n\n');
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
initializeChat();
get('share-button')?.addEventListener('click', () => void sharePlan());
void loadAir();
