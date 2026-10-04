import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDaemon, MAX_EVENTS, MAX_STREAMS, MAX_STREAM_MESSAGES, MAX_STREAM_MESSAGE_BYTES } from '../dist/daemon/server.js';
import { parseObservationEvent, MAX_MESSAGE_TEXT_BYTES } from '../dist/protocol/observation.js';
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
    assert.equal((await fetch(url + '/')).status, 200);
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
