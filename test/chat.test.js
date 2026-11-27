import assert from 'node:assert/strict';
import test from 'node:test';
import { createChat } from '../chat.js';

test('chat recovers from an unexpected context failure and keeps forecast follow-ups', async () => {
  const send = {};
  const messages = {
    rows: [],
    append(node) { this.rows.push(node); },
    setAttribute(name, value) { this[name] = value; },
  };
  const elements = {
    'chat-question': {},
    'chat-messages': messages,
    'chat-form': { querySelector: () => send },
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => elements[id],
    createElement: () => ({ replaceChildren() {}, appendChild() {}, prepend() {}, style: {} }),
    createTextNode: (text) => text,
  };
  try {
    const profiles = [];
    const forecast = { city: 'Delhi', dataMode: 'demo', selectedHours: [{ time: '2026-01-08T08:00', aqi: 181 }] };
    const chat = createChat({
      profile() { throw new Error('Context unavailable'); },
      async api(path, options) {
        if (path === '/api/status') return { chat: { enabled: true, provider: 'gemini' } };
        profiles.push(JSON.parse(options.body).profile);
        return { reply: 'Keep activities flexible.', mode: 'ai', provider: 'gemini' };
      },
    });
    await chat.ask('How is the air?');
    assert.match(messages.rows.at(-1).textContent, /Please try again/);
    assert.equal(send.disabled, false);
    assert.equal(messages['aria-busy'], 'false');

    await chat.ask('Compare these hours', forecast);
    await chat.ask('What about my kids?');
    assert.deepEqual(profiles, [forecast, forecast]);
    assert.equal(send.disabled, false);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
