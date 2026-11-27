import { buildPlan, forecastDecision, localTimeMilliseconds } from './plan.js';
import { get, makeElement, setText, showDialog, svgElement } from './dom.js';
import { createChat } from './chat.js';
import { renderForecastChart } from './forecast-chart.js';

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

const planner = get('planner-form');
const locationDialog = get('location-dialog');
const citySearch = get('city-search');
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
    const age = modelTimeAtLocation(data, new Date()) - localTimeMilliseconds(data.time);
    return age >= -15 * 60 * 1000 && age <= recentEstimateAge;
  } catch {
    return false;
  }
}

function validAir(data) {
  return Number.isFinite(data?.aqi) && data.aqi >= 0 &&
    Number.isFinite(localTimeMilliseconds(data.time));
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
  const localTime = localTimeMilliseconds(time);
  if (!Number.isFinite(localTime)) return '';
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
  const key = locationKey(city) + ':' + airMode;
  const previousSelection = forecastSelection?.key === key ? forecastSelection : null;
  renderForecastChart(get('forecast-chart'), {
    loading, air, airMode, previousSelection, localClock, aqiCategory,
    setNote: (text) => setText('forecast-note', text),
    onSelect: (selection) => {
      forecastSelection = selection ? { ...selection, key } : undefined;
    },
    compareHours: (selection) => forecastDecision(forecastProfile(selection)),
    askAboutHours() {
      const context = forecastProfile();
      chat.open();
      void chat.ask(context.selectedHours.length > 1
        ? 'Compare these two forecast hours for my outdoor plans. What would you suggest?'
        : 'What does this selected forecast hour mean for my outdoor plans?', context);
    },
  });
}


function forecastProfile(selection = forecastSelection) {
  const context = profile();
  const { selected, reference } = selection;
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
    chat.reset();
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

function useCity(place) {
  if (!isCity(place)) return;
  city = place;
  liveLocation = place;
  if (!place.deviceLocation) {
    rememberedCity = place;
    savePreferences();
  }
  chat.reset();
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
  chat.reset();
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

function initializeShare() {
  const dialog = get('share-dialog');
  const preview = get('share-preview');
  const copyButton = get('copy-plan');
  const deviceButton = get('share-from-device');

  get('share-button')?.addEventListener('click', () => {
    if (!latestPlan) return;
    preview.value = shareText();
    setText('share-status', '');
    deviceButton.hidden = typeof navigator.share !== 'function';
    showDialog(dialog, copyButton);
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(preview.value);
      setText('share-status', 'Plan copied to your clipboard.');
    } catch {
      preview.focus();
      preview.select();
      setText('share-status', 'The plan is selected. Use your browser’s Copy command.');
    }
  });

  deviceButton.addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'Clean-air plan', text: preview.value });
    } catch (error) {
      if (error?.name !== 'AbortError') setText('share-status', 'Device sharing is unavailable. You can still copy the plan.');
    }
  });
}

const chat = createChat({ api, profile, resolveChatPlace, profileForChatPlace, localClock });

initializeForm();
initializeLocation();
initializeAirRefresh();
chat.initialize();
initializeShare();
void loadAir();

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
