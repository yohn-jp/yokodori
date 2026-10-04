import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDaemon, MAX_EVENTS, MAX_STREAMS, MAX_STREAM_MESSAGES, MAX_STREAM_MESSAGE_BYTES } from '../dist/daemon/server.js';
import { parseObservationEvent, MAX_MESSAGE_TEXT_BYTES } from '../dist/protocol/observation.js';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { observeGit } from '../dist/adapters/pi/git-observation.js';
const id = 'a'.repeat(64);
const event = (streamId, sequence, kind = 'stream.opened', payload = {}) => ({ version: 1, eventId: `${streamId}-${sequence}`, streamId, sequence, kind, payload, observedAt: new Date(0).toISOString(), source: { adapter: 'fixture' } });
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
test('strict protocol validation', () => {
  assert.deepEqual(parseObservationEvent(event('a', 1)), event('a', 1));
  for (const change of [{ version: 2 }, { payload: { content: 'secret' } }, { kind: 'context.compiled', payload: { digest: id } }, { sequence: 0 }]) assert.throws(() => parseObservationEvent({ ...event('a', 1), ...change }));
  const message = event('a', 2, 'message.observed', { role: 'user', text: 'hello', truncated: false });
  assert.deepEqual(parseObservationEvent(message), message);
  assert.deepEqual(parseObservationEvent(event('a', 2, 'message.observed', { role: 'assistant', text: 'x'.repeat(MAX_MESSAGE_TEXT_BYTES), truncated: true, originalBytes: MAX_MESSAGE_TEXT_BYTES + 1 })).payload,
    { role: 'assistant', text: 'x'.repeat(MAX_MESSAGE_TEXT_BYTES), truncated: true, originalBytes: MAX_MESSAGE_TEXT_BYTES + 1 });
  for (const payload of [
    { role: 'system', text: 'hidden', truncated: false },
    { role: 'user', text: 'x'.repeat(MAX_MESSAGE_TEXT_BYTES + 1), truncated: false },
    { role: 'assistant', text: 'x', truncated: false, originalBytes: 2 },
    { role: 'assistant', text: 'x', truncated: true, originalBytes: 1 },
    { role: 'user', text: 'x', truncated: false, extra: true },
  ]) assert.throws(() => parseObservationEvent(event('a', 2, 'message.observed', payload)));
  assert.equal(parseObservationEvent(event('a', 2, 'git.observed', { root: '/repo', branch: 'main', head: 'a'.repeat(40), dirty: 'clean' })).kind, 'git.observed');
});

test('message snapshots expose bounded conversation, SSE updates, and incomplete history', async () => {
  const daemon = createDaemon(); const url = await daemon.listen();
  const json = async path => (await fetch(url + path)).json();
  try {
    const sse = await fetch(url + '/api/v1/live');
    const reader = sse.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
    assert.equal((await post(url + '/api/v1/streams', { streamId: 'messages' })).status, 201);
    assert.equal((await post(url + '/api/v1/streams/messages/events', event('messages', 1))).status, 201);
    await reader.read();
    const first = event('messages', 2, 'message.observed', { role: 'user', text: 'question', truncated: false });
    assert.equal((await post(url + '/api/v1/streams/messages/events', first)).status, 201);
    assert.match(new TextDecoder().decode((await reader.read()).value), /update/);
    const snapshot = await json('/api/v1/snapshot');
    const stream = snapshot.streams[0];
    assert.deepEqual(stream.messages, [{ sequence: 2, observedAt: first.observedAt, ...first.payload }]);
    assert.deepEqual(stream.messageHistory, { retainedCount: 1, retainedBytes: 8, evictedCount: 0, evictedBytes: 0, truncatedCount: 0, incomplete: false });
    assert.equal((await post(url + '/api/v1/streams/messages/events', first)).status, 200);
    assert.equal((await json('/api/v1/streams/messages')).latest['message.observed'].payload.text, 'question');
    await reader.cancel();
  } finally { await daemon.close(); }
});

test('message history evicts oldest text at the per-stream byte and count bounds', async () => {
  const daemon = createDaemon(); const url = await daemon.listen();
  const json = async path => (await fetch(url + path)).json();
  try {
    assert.equal((await post(url + '/api/v1/streams', { streamId: 'bytes' })).status, 201);
    await post(url + '/api/v1/streams/bytes/events', event('bytes', 1));
    for (let n = 1; n <= Math.floor(MAX_STREAM_MESSAGE_BYTES / MAX_MESSAGE_TEXT_BYTES) + 1; n++) {
      const observation = event('bytes', n + 1, 'message.observed', { role: n % 2 ? 'user' : 'assistant', text: 'x'.repeat(MAX_MESSAGE_TEXT_BYTES), truncated: false });
      assert.equal((await post(url + '/api/v1/streams/bytes/events', observation)).status, 201);
    }
    const byteBound = await json('/api/v1/streams/bytes');
    assert.equal(byteBound.messages.length, Math.floor(MAX_STREAM_MESSAGE_BYTES / MAX_MESSAGE_TEXT_BYTES));
    assert.equal(byteBound.messages[0].sequence, 3);
    assert.deepEqual(byteBound.messageHistory, {
      retainedCount: Math.floor(MAX_STREAM_MESSAGE_BYTES / MAX_MESSAGE_TEXT_BYTES),
      retainedBytes: MAX_STREAM_MESSAGE_BYTES,
      evictedCount: 1,
      evictedBytes: MAX_MESSAGE_TEXT_BYTES,
      truncatedCount: 0,
      incomplete: true,
    });

    assert.equal((await post(url + '/api/v1/streams', { streamId: 'count' })).status, 201);
    await post(url + '/api/v1/streams/count/events', event('count', 1));
    for (let n = 1; n <= MAX_STREAM_MESSAGES + 1; n++) {
      const observation = event('count', n + 1, 'message.observed', { role: 'user', text: 'x', truncated: false });
      assert.equal((await post(url + '/api/v1/streams/count/events', observation)).status, 201);
    }
    const countBound = await json('/api/v1/streams/count');
    assert.equal(countBound.messages.length, MAX_STREAM_MESSAGES);
    assert.equal(countBound.messages[0].sequence, 3);
    assert.equal(countBound.messageHistory.evictedCount, 1);
    assert.equal(countBound.messageHistory.evictedBytes, 1);
  } finally { await daemon.close(); }
});
test('loopback, independent streams, admission, SSE, dashboard, bounded snapshot', async () => {
  const daemon = createDaemon(); const url = await daemon.listen();
  assert.match(url, /^http:\/\/127\.0\.0\.1:/);
  const json = async path => (await fetch(url + path)).json();
  try {
    const page = await fetch(url + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(page.headers.get('content-security-policy'), /style-src 'self'/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-inline/);
    assert.match(html, /href="\/dashboard\.css"/);
    assert.doesNotMatch(html, /<style|\sstyle=/i);
    const css = await fetch(url + '/dashboard.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    const stylesheet = await css.text();
    assert.match(stylesheet, /grid-template-columns: 250px minmax\(0, 1fr\) 320px/);
    assert.match(stylesheet, /\.message-card/);
    assert.match(stylesheet, /white-space: pre-wrap/);
    assert.match(stylesheet, /@media \(max-width: 760px\)/);
    assert.match(await (await fetch(url + '/dashboard.js')).text(), /EventSource/);
    const sse = await fetch(url + '/api/v1/live');
    const reader = sse.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
    for (const name of ['a', 'b']) {
      assert.equal((await post(url + '/api/v1/streams', { streamId: name })).status, 201);
      assert.equal((await post(url + `/api/v1/streams/${name}/events`, event(name, 1))).status, 201);
    }
    assert.match(new TextDecoder().decode((await reader.read()).value), /update/);
    await reader.cancel();
    assert.equal((await post(url + '/api/v1/streams/a/events', event('a', 1))).status, 200);
    assert.equal((await post(url + '/api/v1/streams/a/events', { ...event('a', 1), payload: { parentStreamId: 'b' } })).status, 409);
    assert.equal((await post(url + '/api/v1/streams/a/events', event('b', 2))).status, 409);
    assert.equal((await post(url + '/api/v1/streams/a/events', event('a', 3))).status, 409);
    assert.equal((await post(url + '/api/v1/streams/a/events', event('a', 2, 'context.compiled', { digest: id, sourceCount: 1, rendererVersion: '1' }))).status, 201);
    assert.equal((await json('/api/v1/snapshot')).streams.length, 2);
    assert.equal((await json('/api/v1/streams')).length, 2);
    assert.equal((await json('/api/v1/streams/a')).sequence, 2);
    assert.equal((await json('/api/v1/events')).length, 3);
    assert.equal((await fetch(url + '/')).status, 200); // reconnect recovers from snapshot, not replay
    assert.doesNotMatch(JSON.stringify(await json('/api/v1/snapshot')), /secret/);
    for (let n = 3; n <= MAX_EVENTS + 5; n++) assert.equal((await post(url + '/api/v1/streams/a/events', event('a', n, 'context.injected', { state: 'injected', boundary: 'fixture' }))).status, 201);
    assert.equal((await json('/api/v1/streams/a')).events.length, MAX_EVENTS);
    for (let n = 0; n < MAX_STREAMS; n++) await post(url + '/api/v1/streams', { streamId: `new${n}` });
    assert.equal((await json('/api/v1/snapshot')).streams.length, MAX_STREAMS);
  } finally { await daemon.close(); }
});
test('Git observation is read-only', async () => {
  const git = await observeGit(process.cwd());
  assert.ok(git?.root && git?.head && ['clean', 'dirty', 'unknown'].includes(git.dirty));
});

test('dashboard renders conversation observations and keeps snapshot/SSE selection', async () => {
  class Element {
    constructor(tagName = '') { this.tagName = tagName; this.children = []; this.listeners = new Map(); this.value = ''; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) {
      for (const child of children) {
        this.children.push(child);
        if (this.tagName === 'SELECT' && !this.value && child.tagName === 'OPTION') this.value = child.value;
      }
    }
    replaceChildren(...children) { this.children = []; this._text = ''; if (this.tagName === 'SELECT') this.value = ''; this.append(...children); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    setAttribute(name, value) { this[name] = value; }
  }
  const ids = ['stream', 'current', 'repo', 'context', 'timeline', 'conversation'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id === 'stream' ? 'SELECT' : 'DIV')]));
  let snapshot = { streams: [] };
  let live;
  const document = {
    getElementById: id => elements[id],
    createElement: tagName => new Element(tagName.toUpperCase()),
    createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; }
  };
  const context = {
    document,
    fetch: async () => ({ ok: true, json: async () => snapshot }),
    EventSource: class {
      constructor(url) { this.url = url; this.listeners = new Map(); live = this; }
      addEventListener(name, handler) { this.listeners.set(name, handler); }
    }
  };
  const script = await readFile(new URL('../dist/dashboard/dashboard.js', import.meta.url), 'utf8');
  const message = (sequence, role, text, truncated = false, originalBytes) => ({
    ...event('two', sequence, 'message.observed'), observedAt: `2026-01-01T00:00:0${sequence}.000Z`,
    payload: { role, text, truncated, ...(originalBytes === undefined ? {} : { originalBytes }) }
  });
  const streamTwo = {
    streamId: 'two', sequence: 7, closed: false,
    latest: {
      'stream.opened': event('two', 1),
      'git.observed': event('two', 2, 'git.observed', { root: '/repo', branch: 'main', head: 'a'.repeat(40), dirty: 'clean' }),
      'context.compiled': event('two', 3, 'context.compiled', { digest: id, sourceCount: 2, rendererVersion: '1' }),
      'context.injected': event('two', 4, 'context.injected', { state: 'injected', boundary: 'pi' }),
      'context.observed': event('two', 5, 'context.observed', { requestSequence: 1, boundary: 'pi', complete: true, certification: 'MATCH' })
    },
    events: [event('two', 1), event('two', 2, 'git.observed', { root: '/repo', branch: 'main', head: 'a'.repeat(40), dirty: 'clean' })],
    messages: [
      { sequence: 6, observedAt: '2026-01-01T00:00:06.000Z', role: 'user', text: 'What changed?', truncated: false },
      { sequence: 7, observedAt: '2026-01-01T00:00:07.000Z', role: 'assistant', text: 'The <b>status</b> is clean.', truncated: true, originalBytes: 64 }
    ]
  };
  const streamOne = { streamId: 'one', sequence: 1, closed: false, latest: {}, events: [event('one', 1)] };
  snapshot = { streams: [streamOne, streamTwo] };
  elements.stream.value = 'two';
  await runInNewContext(script, context);

  assert.equal(live.url, '/api/v1/live');
  assert.equal(elements.stream.value, 'two');
  assert.match(elements.repo.textContent, /\/repo · main · a{12} · clean/);
  assert.match(elements.context.textContent, /MATCH · complete/);
  assert.match(elements.timeline.textContent, /git\.observed/);
  assert.match(elements.conversation.textContent, /What changed\?/);
  assert.match(elements.conversation.textContent, /The <b>status<\/b> is clean\./);
  assert.match(elements.conversation.textContent, /Assistant/);
  assert.match(elements.conversation.textContent, /#7/);
  assert.match(elements.conversation.textContent, /Truncated · 64 bytes/);
  assert.doesNotMatch(elements.conversation.textContent, /system prompt/i);

  elements.stream.value = 'one';
  await elements.stream.listeners.get('change')();
  assert.equal(elements.stream.value, 'one');
  assert.match(elements.conversation.textContent, /No retained conversation observations yet/);

  snapshot = { streams: [streamTwo, streamOne] };
  await live.listeners.get('update')();
  assert.equal(elements.stream.value, 'one');
  assert.match(elements.conversation.textContent, /No retained conversation observations yet/);
  await live.listeners.get('open')();
  assert.equal(elements.stream.value, 'one');
});
