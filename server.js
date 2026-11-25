import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { RequestError, findCities, createAirLookup, answerChat, resolveChatModel } from './air-service.js';

const root = dirname(fileURLToPath(import.meta.url));
const rootFiles = new Set(['index.html', 'styles.css', 'app.js', 'plan.js']);
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

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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
      'Content-Type': mime,
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
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
        sendJson(response, 200, await answerChat(await readJson(request), fetchImpl, chat));
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

