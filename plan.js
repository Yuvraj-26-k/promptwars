// EPA's average gasoline passenger vehicle emits 400 g of tailpipe CO₂ per mile.
const kilogramsPerKilometer = 0.4 / 1.609344;

const categories = [
  { max: 50, name: 'Good', headline: 'Make the most of clearer air' },
  { max: 100, name: 'Moderate', headline: 'Plan around changes in air quality' },
  { max: 150, name: 'Unhealthy for sensitive groups', headline: 'Keep outdoor activity flexible' },
  { max: 200, name: 'Unhealthy', headline: 'Move strenuous activities indoors' },
  { max: 300, name: 'Very unhealthy', headline: 'Make today an indoor day' },
  { max: Infinity, name: 'Hazardous', headline: 'Stay in cleaner indoor air' },
];

const householdActivities = {
  family: 'play or exercise',
  sensitive: 'exercise or errands',
  community: 'group activities',
  individual: 'exercise or errands',
};

const formatNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

function nonnegativeNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function describeAvoidedDrive(distance) {
  if (distance === null || distance === 0) {
    return 'Replacing a dedicated drive avoids that car’s tailpipe emissions.';
  }

  const roundTrip = distance * 2;
  const avoided = roundTrip * kilogramsPerKilometer;
  if (!Number.isFinite(avoided)) return 'Replacing a dedicated drive avoids that car’s tailpipe emissions.';

  const amount = avoided < 0.1 ? 'less than 0.1' : `about ${formatNumber.format(avoided)}`;
  return `Avoiding the ${formatNumber.format(roundTrip)} km gasoline-car round trip saves ${amount} kg of tailpipe CO₂ from that car.`;
}

function routineAction(aqi, household, habits) {
  const sensitive = household === 'family' || household === 'sensitive';
  const activity = habits.includes('school') ? 'outdoor play or practice' : householdActivities[household];
  const exercise = habits.includes('outdoor');
  let title;
  let description;
  let impact;

  if (aqi >= 301) {
    title = 'Pause outdoor activity';
    if (household === 'community') {
      description = 'Move group activities to a cleaner indoor space or online, or postpone them. Share local air-quality alerts before people travel.';
    } else if (habits.includes('school')) {
      description = 'Skip outdoor play and check the school’s plan for recess or practice. Postpone nonessential trips and follow local alerts.';
    } else {
      description = 'Postpone outdoor exercise and nonessential trips. Follow local alerts and spend time in a cleaner indoor space.';
    }
    impact = 'Staying in cleaner air reduces the time you spend breathing outdoor particles.';
  } else if (aqi >= 201) {
    title = `Move ${activity} indoors`;
    description = sensitive
      ? 'Skip outdoor exercise and keep essential trips brief. Check local alerts before heading out.'
      : 'Move demanding activities to a cleaner indoor space and postpone long outdoor trips until the air improves.';
    impact = 'Less time outside and less heavy breathing outdoors can lower particle exposure.';
  } else if (aqi >= 151) {
    title = `Bring ${activity} indoors`;
    description = sensitive
      ? 'Move long or strenuous activities inside. Keep essential outdoor time shorter and check the AQI again before leaving.'
      : 'Shorten outdoor sessions, lower the intensity, and take more breaks. Move longer sessions indoors if you can.';
    impact = 'Shorter or gentler outdoor activity can reduce the amount of polluted air you breathe in.';
  } else if (aqi === null || aqi >= 101) {
    title = 'Check before heading out';
    description = aqi === null
      ? 'Check a local report before scheduling outdoor exercise. If the air is unhealthy, move strenuous activity to a cleaner indoor space.'
      : `Check the next local reading before ${activity}. Children, older adults, and people with heart or lung conditions can shorten longer sessions and take more breaks.`;
    impact = 'Timing activities for cleaner hours can lower particle exposure.';
  } else {
    title = exercise ? 'Choose a lower-traffic route' : 'Use the cleaner hours';
    description = `Plan ${activity} away from busy roads. Check again before a long session because conditions can change through the day.`;
    impact = 'Staying farther from traffic can reduce exposure to nearby exhaust and particles.';
  }

  return { category: 'Daily routine', title, description, impact, icon: 'sun' };
}

function indoorAction(aqi, household, habits) {
  const hasPurifier = habits.includes('purifier');
  const highPollution = aqi !== null && aqi >= 151;
  const room = household === 'community' ? 'shared room' : 'room you use most';
  let title;
  let description;
  let impact;

  if (highPollution || hasPurifier) {
    title = highPollution ? 'Set up a cleaner-air room' : 'Make your purifier count';
    const ventilation = highPollution
      ? 'Keep windows closed during the pollution spike if you can keep the room comfortable, then air it out when outdoor conditions improve.'
      : 'Keep the air intake clear and replace the filter on schedule.';
    const filtration = hasPurifier
      ? `Run your air purifier in the ${room}.`
      : `Use a room-sized HEPA purifier in the ${room} if available.`;
    description = `${filtration} ${ventilation}`;
    impact = highPollution
      ? 'Particle filtration removes airborne particles, and closing windows during spikes limits how much comes inside.'
      : 'Running a correctly sized filter can lower the concentration of fine particles in that room.';
    if (highPollution && habits.includes('cooking')) {
      description += ' Choose a low-smoke meal if you’re cooking.';
    }
  } else if (habits.includes('cooking')) {
    title = 'Cook with less smoke';
    description = 'Use a range hood that vents outdoors if available. Choose simmering or steaming over frying, and avoid charring food.';
    impact = 'Lower-smoke cooking and outdoor exhaust can reduce the particles that build up indoors.';
  } else {
    title = 'Cut indoor smoke at the source';
    description = 'Skip candles and incense, keep smoking outside away from doors and windows, and avoid unvented fuel-burning heaters.';
    impact = 'Reducing indoor combustion prevents extra particles from building up in shared air.';
  }

  return { category: 'Indoor air', title, description, impact, icon: 'home' };
}

function swapAction(aqi, household, commute, distance) {
  const restrictActiveTravel = aqi === null || aqi >= 101;
  const stayIn = aqi !== null && aqi >= 201;
  let title;
  let description;
  let impact;
  let icon = 'leaf';

  if (commute === 'car') {
    title = stayIn ? 'Skip one car round trip' : 'Replace one solo drive';
    description = stayIn
      ? 'Move a meeting online, combine essential errands, or postpone a trip until the air improves.'
      : 'Take an existing bus or train service if it works for the trip, or combine errands into one drive.';
    impact = describeAvoidedDrive(distance);
    icon = stayIn ? 'leaf' : 'train';
  } else if (commute === 'transit') {
    title = stayIn ? 'Defer optional journeys' : 'Keep using shared transit';
    description = stayIn
      ? 'Postpone optional trips. For essential journeys, check departure times and use indoor waiting areas if available.'
      : 'Check departures before leaving home and use a direct route where possible to limit waits by busy roads.';
    impact = stayIn
      ? 'Less time waiting outdoors reduces time spent breathing outdoor pollution.'
      : 'Shared transit helps limit the number of individual vehicles needed for those journeys.';
    icon = 'train';
  } else if (commute === 'walk' || commute === 'bike') {
    title = restrictActiveTravel ? 'Save active trips for cleaner air' : `Keep the ${commute === 'walk' ? 'walk' : 'bike ride'}`;
    description = restrictActiveTravel
      ? 'Defer optional trips when pollution is elevated. For an essential trip, use a nearby shared transit option if available and minimize outdoor waits.'
      : 'Choose a quieter street away from traffic and use your usual active trip in place of a short car ride when practical.';
    impact = restrictActiveTravel
      ? 'Shifting strenuous travel away from polluted hours can reduce the amount of pollution you breathe.'
      : 'Walking and cycling produce zero tailpipe emissions during the trip.';
    icon = commute === 'bike' ? 'bike' : 'leaf';
  } else {
    title = household === 'community' ? 'Coordinate errands with neighbors' : 'Bundle optional errands';
    description = 'Use online appointments where practical and group essential pickups into one trip. Wait for better air before taking optional trips.';
    impact = 'Fewer dedicated car trips mean fewer tailpipe emissions.';
  }

  return { category: 'Sustainable swap', title, description, impact, icon };
}

export function buildPlan({ city, aqi, pm25, household, commute, distance, habits, dataMode, sample } = {}) {
  const cityName = typeof city === 'string' && city.trim() ? city.trim() : 'your area';
  const rawAqi = nonnegativeNumber(aqi);
  const currentAqi = rawAqi === null ? null : Math.round(rawAqi);
  const particles = nonnegativeNumber(pm25);
  const group = Object.hasOwn(householdActivities, household) ? household : 'individual';
  const selectedHabits = Array.isArray(habits) ? habits : [];
  const level = currentAqi === null ? null : categories.find(({ max }) => currentAqi <= max);
  const conditions = dataMode === 'demo' || sample === true ? `Sample conditions for ${cityName}` : `Conditions for ${cityName}`;
  const summary = level
    ? `${conditions} show a U.S. AQI of ${formatNumber.format(currentAqi)} (${level.name})${particles === null ? '' : `, with PM₂.₅ at ${formatNumber.format(particles)} µg/m³`}. Use these steps to limit exposure and cut avoidable emissions.`
    : `The AQI for ${cityName} is unavailable. Check local air quality before outdoor activity and use these steps when pollution rises.`;

  return {
    headline: level?.headline ?? 'Start with a local air check',
    summary,
    actions: [
      routineAction(currentAqi, group, selectedHabits),
      indoorAction(currentAqi, group, selectedHabits),
      swapAction(currentAqi, group, commute, nonnegativeNumber(distance)),
    ],
    footnote: 'CO₂ estimates use 0.249 kg per km for a typical gasoline car. They cover only the car trip you avoid. Exposure changes depend on local conditions and are described qualitatively.',
  };
}

export function localReply(question, profile) {
  const topic = typeof question === 'string' ? question.toLowerCase() : '';
  const plan = buildPlan(profile);
  const [routine, indoor, swap] = plan.actions;
  const aqi = nonnegativeNumber(profile?.aqi);

  if (/\b(can(?:not|'t|’t) breathe|severe (?:trouble|difficulty) breathing|struggling to breathe)\b/.test(topic)) {
    return 'If anyone is having severe difficulty breathing, contact your local emergency services now.';
  }

  if (/\b(what (does|is|are)|what’s|what's|explain|define|meaning of)\b.{0,25}\b(aqi|pm\s?2\.?5|air quality|reading)\b/.test(topic)) {
    return `${plan.summary} AQI summarizes outdoor pollution and health concern. PM₂.₅ measures the concentration of fine particles in the outdoor air.`;
  }

  if (/\b(windows?|ventilat\w*|air out|fresh air)\b/.test(topic)) {
    const timing = aqi !== null && aqi <= 100 && profile?.dataMode !== 'demo' && profile?.sample !== true
      ? 'Check the latest local reading and air out the room briefly if outdoor air and weather permit.'
      : 'During high outdoor pollution, keep windows closed if the room stays comfortable. Air out the room once outdoor air improves.';
    return `${timing} Closing windows during a spike can reduce the amount of particle pollution that comes indoors.`;
  }

  if (/\b(cook\w*|fry\w*|kitchen|stove|dinner)\b/.test(topic)) {
    return 'Try a lower-smoke meal such as simmered or steamed food. If you have a range hood that vents outdoors, run it during cooking and for 10–20 minutes after. This captures some of the particles before they spread through the home.';
  }

  if (/\b(?:without|no|can(?:not|'t|’t) afford)\b.{0,22}\b(?:purifier|air cleaner|hepa|filter)\b|\b(?:on a budget|low[- ]cost)\b.{0,22}\b(?:indoor|air)\b/.test(topic)) {
    const ventilation = aqi !== null && aqi >= 151
      ? 'During outdoor pollution spikes, keep windows closed if the room stays comfortable. Air it out when conditions improve.'
      : 'Check outdoor air quality before opening the windows.';
    return `Skip candles, incense, and indoor smoking. Choose steaming or simmering over frying to make fewer cooking particles. ${ventilation} These steps cut pollution you create indoors and limit particles that come in from outside.`;
  }

  if (/\b(purifier|hepa|filter\w*|indoor|inside|cleaner\s+air\s+room)\b/.test(topic)) {
    return `${indoor.description} ${indoor.impact} If you’re choosing a purifier for particles, look for a HEPA unit sized for the room that does not intentionally generate ozone.`;
  }

  if (/\b(commut\w*|trip\w*|driv\w*|car|bik\w*|cycl\w*|transit|bus|train|co₂|co2|carbon|emissions)\b/.test(topic)) {
    return `${swap.description} ${swap.impact}`;
  }

  if (/\b(outside|outdoors?|exercise|recess|school|sport\w*|run\w*|walk\w*|play\w*|children|kids)\b/.test(topic)) {
    return `${routine.description} ${routine.impact}`;
  }

  if (/\b(aqi|pm\s?2\.?5|air quality|reading)\b/.test(topic)) return plan.summary;

  return `${plan.headline}. ${routine.description}\n\n${indoor.description}\n\n${swap.description} ${swap.impact}`;
}
