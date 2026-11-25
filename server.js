import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { RequestError, findCities, createAirLookup, answerChat, resolveChatModel } from './air-service.js';

const root = dirname(fileURLToPath(import.meta.url));
const rootFiles = new Set(['index.html', 'styles.css', 'app.js', 'plan.js', 'forecast-chart.js', 'dom.js']);
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);
const bodyLimit = 16_384;
const chatLimits = {
  requestsPerClientPerMinute: 12,
  requestsPerMinute: 30,
  aiRequestsPerDay: 200,
  concurrentRequests: 3,
};
const minuteMs = 60_000;
const dayMs = 86_400_000;

const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'"
    ].join('; ')
};

function createChatGuard() {
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

    clients.set(clientAddress, clientCount + 1);
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

function sendJson(response, status, data) {
  response.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const mediaType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new RequestError(415, 'Set Content-Type to application/json.');
  }
  if (Number(request.headers['content-length']) > bodyLimit) {
    throw new RequestError(413, 'Chat request is too large.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) throw new RequestError(413, 'Chat request is too large.');
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Send a valid JSON chat request.');
  }
}

async function serveFile(request, response, pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  const extension = extname(name).toLowerCase();
  const mime = mimeTypes.get(extension);
  const asset = /^(?:assets|images)\/(?:[\w-]+\/)*[\w-]+\.[a-z\d]+$/i.test(name);
  if (!mime || (!rootFiles.has(name) && !asset && name !== 'favicon.ico')) {
    throw new RequestError(404, 'Page not found.');
  }

  try {
    const file = await realpath(resolve(root, name));
    const path = relative(root, file);
    if (path !== name.split('/').join(sep)) {
      throw new RequestError(404, 'Page not found.');
    }
    const data = await readFile(file);
    response.writeHead(200, {
      ...securityHeaders,
      'Content-Type': mime,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) {
      throw new RequestError(404, 'Page not found.');
    }
    throw error;
  }
}

export function createAppServer({
  fetchImpl = fetch,
  provider = process.env.AI_PROVIDER,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL,
  geminiApiKey = process.env.GEMINI_API_KEY,
  geminiModel = process.env.GEMINI_MODEL,
} = {}) {
  const chat = resolveChatModel({ provider, apiKey, model, geminiApiKey, geminiModel, ollamaModel: process.env.OLLAMA_MODEL });
  const lookupAir = createAirLookup(fetchImpl);
  const guardChat = createChatGuard();
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    try {
      const host = request.headers.host?.toLowerCase();
      if (!host || (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) && host !== process.env.RENDER_EXTERNAL_HOSTNAME?.toLowerCase())) {
        throw new RequestError(403, 'Open this application through localhost.');
      }
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/cities') {
        sendJson(response, 200, await findCities(fetchImpl, url.searchParams));
      } else if (request.method === 'GET' && url.pathname === '/api/air') {
        sendJson(response, 200, await lookupAir(url.searchParams));
      } else if (request.method === 'GET' && url.pathname === '/api/status') {
        const { enabled, provider, model } = chat;
        sendJson(response, 200, { chat: { enabled, provider, model } });
      } else if (request.method === 'POST' && url.pathname === '/api/chat') {
        const clientAddress = request.socket?.remoteAddress ?? 'unknown';
        const result = await guardChat(clientAddress, chat.enabled, async () => {
          const input = await readJson(request);
          return answerChat(input, fetchImpl, chat);
        });
        sendJson(response, 200, result);
      } else if (['GET', 'HEAD'].includes(request.method)) {
        await serveFile(request, response, url.pathname);
      } else {
        throw new RequestError(405, 'Method not allowed.');
      }
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.status, { error: error.message });
      } else {
        sendJson(response, 500, { error: 'The server could not complete this request.' });
      }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadEnvFile(resolve(root, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const port = Number(process.env.PORT ?? 3000);
  createAppServer().listen(port, '0.0.0.0', function announce() {
    console.log(`Open http://127.0.0.1:${this.address().port} in your browser.`);
  });
}

