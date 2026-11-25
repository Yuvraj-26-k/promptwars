import { RequestError, findCities, createAirLookup, answerChat, resolveChatModel } from './air-service.js';
import { assets } from './generated-assets.js';

const lookup = createAirLookup(fetch);

async function readQuestion(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new RequestError(415, 'Send a JSON question.');
  }
  let bytes = 0;
  const parts = [];
  for await (const part of request.body || []) {
    bytes += part.length;
    if (bytes > 16384) throw new RequestError(413, 'Chat request is too large.');
    parts.push(part);
  }
  try { return JSON.parse(await new Blob(parts).text()); }
  catch { throw new RequestError(400, 'Send a valid JSON chat request.'); }
}

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    try {
      if (request.method === 'GET' && pathname === '/api/air') return Response.json(await lookup(searchParams));
      if (request.method === 'GET' && pathname === '/api/cities') return Response.json(await findCities(fetch, searchParams));
      const chat = resolveChatModel({ apiKey: env.OPENAI_API_KEY, geminiApiKey: env.GEMINI_API_KEY, model: env.OPENAI_MODEL, geminiModel: env.GEMINI_MODEL });
      if (request.method === 'GET' && pathname === '/api/status') {
        return Response.json({ chat: { enabled: chat.enabled, provider: chat.provider, model: chat.model } });
      }
      if (request.method === 'POST' && pathname === '/api/chat') return Response.json(await answerChat(await readQuestion(request), fetch, chat));
      const asset = assets[pathname === '/' ? '/index.html' : pathname];
      if (asset && ['GET', 'HEAD'].includes(request.method)) {
        return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), c => c.charCodeAt(0)), {
          headers: { 'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff' }
        });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return Response.json({ error: err instanceof RequestError ? err.message : 'Service unavailable.' }, { status: err instanceof RequestError ? err.status : 503 });
    }
  }
};
