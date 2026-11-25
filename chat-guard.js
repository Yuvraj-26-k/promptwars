import { RequestError } from './air-service.js';

export const chatBodyLimit = 16_384;
const chatLimits = {
  requestsPerClientPerMinute: 12,
  requestsPerMinute: 30,
  aiRequestsPerDay: 200,
  concurrentRequests: 3,
};
const minuteMs = 60_000;
const dayMs = 86_400_000;

export function createChatGuard() {
  const clients = new Map();
  let minute;
  let day;
  let minuteCount = 0;
  let dailyAiCount = 0;
  let active = 0;

  return async function guard(clientAddress, aiEnabled, handler) {
    const now = Date.now();
    const currentMinute = Math.floor(now / minuteMs);
    const currentDay = Math.floor(now / dayMs);

    if (currentMinute !== minute) {
      minute = currentMinute;
      minuteCount = 0;
      clients.clear();
    }
    if (currentDay !== day) {
      day = currentDay;
      dailyAiCount = 0;
    }

    const clientCount = clients.get(clientAddress) ?? 0;
    if (clientCount >= chatLimits.requestsPerClientPerMinute || minuteCount >= chatLimits.requestsPerMinute) {
      throw new RequestError(429, 'Too many requests. Please try again shortly.');
    }
    if (aiEnabled && dailyAiCount >= chatLimits.aiRequestsPerDay) {
      throw new RequestError(429, 'Daily AI usage limit reached.');
    }
    if (active >= chatLimits.concurrentRequests) {
      throw new RequestError(429, 'Assistant is busy. Please try again shortly.');
    }

    if (clientAddress) clients.set(clientAddress, clientCount + 1);
    minuteCount++;
    if (aiEnabled) dailyAiCount++;
    active++;
    try {
      return await handler();
    } finally {
      active--;
    }
  };
}
