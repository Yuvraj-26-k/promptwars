import { findCleanerWindow, findLowerAqiHour } from './plan.js';
import { makeElement, svgElement } from './dom.js';

export function renderForecastChart(container, {
  loading, air, airMode, previousSelection, localClock, aqiCategory,
  setNote, onSelect, compareHours, askAboutHours,
}) {
  if (!container) return;
  const focusedControl = container.contains(document.activeElement)
    ? document.activeElement.dataset.forecastControl : undefined;

  const selectedTime = previousSelection?.selected?.time;
  let pinnedTime = previousSelection?.reference?.time;
  onSelect();
  container.replaceChildren();
  const points = (airMode !== 'cached' && Array.isArray(air?.forecast) ? air.forecast : [])
    .filter((point) => point && Number.isFinite(point.aqi) && typeof point.time === 'string').slice(0, 24);
  if (points.length < 2) {
    const status = makeElement('div', 'forecast-empty', loading ? 'Loading forecast…' : 'Forecast unavailable');
    status.setAttribute('role', 'status');
    container.append(status);
    setNote(airMode === 'cached' && !loading ? 'A fresh estimate is needed for forecast guidance.' : '');
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
    const selection = { selected: point, reference: pinned };
    onSelect(selection);
    pinnedMarker.setAttribute('visibility', pinned ? 'visible' : 'hidden');
    if (pinned) {
      pinnedMarker.setAttribute('cx', xAt(pinnedIndex));
      pinnedMarker.setAttribute('cy', yAt(pinned.aqi));
    }
    pin.textContent = pinned ? 'Clear pinned hour' : 'Pin this hour';
    askHour.textContent = pinned && pinned !== point ? 'Ask about these hours' : 'Ask about this hour';
    const decision = pinned && pinned !== point ? compareHours(selection) : null;
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
  askHour.addEventListener('click', askAboutHours);
  selectHour(Math.max(0, points.findIndex((point) => point.time === selectedTime)));
  const focusTarget = [control, pin, findHour, askHour].find((element) => element.dataset.forecastControl === focusedControl);
  focusTarget?.focus({ preventScroll: true });

  const range = `${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))}`;
  if (airMode === 'demo') {
    setNote(`Sample forecast · AQI ${range}`);
  } else {
    const window = findCleanerWindow(points, air.time);
    if (window && window.maxAqi + 15 <= air.aqi) {
      const start = localClock(window.start, window.start.slice(0, 10) !== air.time.slice(0, 10), false);
      const end = localClock(window.end, window.end.slice(0, 10) !== window.start.slice(0, 10), false);
      setNote(`Lower-AQI window · ${start} to ${end} local time · up to ${Math.round(window.maxAqi)}`);
    } else if (values.every((value) => value >= 151)) {
      setNote('The forecast stays at unhealthy levels.');
    } else {
      setNote(`Forecast AQI ${range} · all times local`);
    }
  }
}
