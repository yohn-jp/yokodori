import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDaemon, MAX_EVENTS, MAX_STREAMS } from '../dist/daemon/server.js';
import { parseObservationEvent } from '../dist/protocol/observation.js';
import { observeGit } from '../dist/adapters/pi/git-observation.js';
const id = 'a'.repeat(64);
const event = (streamId, sequence, kind = 'stream.opened', payload = {}) => ({ version: 1, eventId: `${streamId}-${sequence}`, streamId, sequence, kind, payload, observedAt: new Date(0).toISOString(), source: { adapter: 'fixture' } });
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
test('strict protocol validation', () => {
  assert.deepEqual(parseObservationEvent(event('a', 1)), event('a', 1));
  for (const change of [{ version: 2 }, { payload: { content: 'secret' } }, { kind: 'context.compiled', payload: { digest: id } }, { sequence: 0 }]) assert.throws(() => parseObservationEvent({ ...event('a', 1), ...change }));
  assert.equal(parseObservationEvent(event('a', 2, 'git.observed', { root: '/repo', branch: 'main', head: 'a'.repeat(40), dirty: 'clean' })).kind, 'git.observed');
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
