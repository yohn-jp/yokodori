import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDaemon } from '../dist/daemon/server.js';
import { MESSAGE_PROFILE } from '../dist/protocol/classification.js';
import { messageState } from '../dist/daemon/classification-client.js';
import { CLASSIFICATION_CONCURRENCY, CLASSIFICATION_QUEUE_LIMIT } from '../dist/daemon/classification-scheduler.js';

const event = (sequence, kind, payload = {}) => ({ version: 1, eventId: `id-${sequence}`, streamId: 's', sequence, kind, payload, observedAt: new Date(0).toISOString(), source: { adapter: 'fixture' } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(handler) {
  const server = createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(resolve)); } };
}
async function setup() {
  const daemon = createDaemon(); const url = await daemon.listen();
  const post = async (path, value) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  await post('/api/v1/streams', { streamId: 's' });
  await post('/api/v1/streams/s/events', event(1, 'stream.opened'));
  const snapshot = async () => (await (await fetch(url + '/api/v1/snapshot')).json()).streams[0];
  return { daemon, url, post, snapshot };
}
async function until(fn) { for (let n = 0; n < 150; n++) { const result = await fn(); if (result) return result; await delay(10); } throw new Error('timeout'); }
const message = n => event(n, 'message.observed', { role: 'user', text: `text ${n}`, truncated: false });
const results = () => MESSAGE_PROFILE.axes.map(axis => ({ id: axis.id, type: 'choice', choice: axis.choices[0], confidence: 1,
  probabilities: Object.fromEntries(axis.choices.map((choice, i) => [choice, i === 0 ? 1 : 0])) }));
const reply = { schema: 'hachidori.v1', results: results(), served: { model: 'm', provider: 'p' }, timing: { inference_ms: 2, total_ms: 3 } };

test('canonical profile and deterministic role/text-only state', () => {
  assert.deepEqual(MESSAGE_PROFILE.axes.map(({ id, version, choices }) => [id, version, choices]), [
    ['activity', 1, ['implement','test','debug','research','review','verify','release','other']],
    ['intent', 1, ['instruction','question','correction','approval','rejection','proposal','explanation','other']],
    ['domain', 1, ['ui','architecture','git','testing','release','runtime','other']],
    ['execution_state', 1, ['exploration','decision','implementation','verification','blocked','other']],
  ]);
  assert.deepEqual([MESSAGE_PROFILE.id, MESSAGE_PROFILE.version], ['message', 1]);
  assert.equal(messageState('user', 'hello'), '{"role":"user","text":"hello"}');
});

test('one four-axis HTTP request, duplicate dedupe, completion projection and SSE update', async () => {
  let calls = 0; let request;
  const h = await fixture(async (req, res) => { calls++; request = JSON.parse(await new Response(req).text()); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply)); });
  process.env.HACHIDORI_ENDPOINT = h.url;
  const d = await setup();
  try {
    const live = await fetch(d.url + '/api/v1/live');
    const response = await d.post('/api/v1/streams/s/events', message(2));
    assert.equal(response.status, 201);
    const complete = await until(async () => { const s = await d.snapshot(); return s.classifications[0]?.status === 'complete' && s; });
    assert.equal((await d.post('/api/v1/streams/s/events', message(2))).status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(request.questions.map(q => q.id), MESSAGE_PROFILE.axes.map(a => a.id));
    assert.equal(request.state, messageState('user', 'text 2'));
    assert.equal(complete.sequence, 2);
    assert.equal(complete.classifications[0].sourceEventId, 'id-2');
    assert.equal(complete.classifications[0].sourceSequence, 2);
    assert.deepEqual(complete.classifications[0].axes, results().map(({ id, choice, confidence, probabilities }) => ({ id, choice, confidence, probabilities })));
    assert.deepEqual(complete.classifications[0].classifier, { schema: 'hachidori.v1', model: 'm', provider: 'p' });
    assert.deepEqual(complete.classifications[0].timing, { inferenceMs: 2, totalMs: 3 });
    const reader = live.body.getReader();
    let updates = '';
    while (!updates.includes('event: update')) updates += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
  } finally { await d.daemon.close(); await h.close(); delete process.env.HACHIDORI_ENDPOINT; }
});

test('unavailable, 503, malformed and timeout are fail-open; later messages continue', async () => {
  let mode = '503';
  const h = await fixture((_req, res) => {
    if (mode === 'timeout') return;
    res.writeHead(mode === '503' ? 503 : 200, { 'content-type': 'application/json' });
    res.end(mode === 'malformed' ? JSON.stringify({ ...reply, results: [{ id: 'unknown' }] }) : '{}');
  });
  process.env.HACHIDORI_ENDPOINT = h.url;
  const d = await setup();
  try {
    for (const [n, next, expected] of [[2,'503','unavailable'],[3,'malformed','failed'],[4,'timeout','failed']]) {
      mode = next; assert.equal((await d.post('/api/v1/streams/s/events', message(n))).status, 201);
      const result = await until(async () => (await d.snapshot()).classifications.find(c => c.sourceSequence === n && c.status !== 'pending'));
      assert.equal(result.status, expected); assert.ok(result.failure); assert.ok(result.axes.every(a => !a.choice));
    }
    process.env.HACHIDORI_ENDPOINT = 'http://127.0.0.1:1';
    assert.equal((await d.post('/api/v1/streams/s/events', message(5))).status, 201);
    assert.equal((await until(async () => (await d.snapshot()).classifications.find(c => c.sourceSequence === 5 && c.status !== 'pending'))).status, 'unavailable');
  } finally { await d.daemon.close(); await h.close(); delete process.env.HACHIDORI_ENDPOINT; }
});

test('slow classifier never delays acceptance; bounded burst, eviction and shutdown', async () => {
  let active = 0, peak = 0, calls = 0;
  const h = await fixture(() => { calls++; active++; peak = Math.max(peak, active); });
  process.env.HACHIDORI_ENDPOINT = h.url;
  const d = await setup();
  try {
    const start = Date.now();
    for (let n = 2; n <= 75; n++) assert.equal((await d.post('/api/v1/streams/s/events', message(n))).status, 201);
    assert.ok(Date.now() - start < 8000);
    const s = await d.snapshot();
    assert.equal(s.sequence, 75); assert.equal(s.messages.length, 64);
    assert.equal(s.classifications.length, 64);
    assert.ok(s.classifications.every(c => s.messages.some(m => m.sequence === c.sourceSequence && c.sourceEventId === `id-${m.sequence}`)));
    assert.ok(calls <= CLASSIFICATION_CONCURRENCY);
    assert.ok(peak <= CLASSIFICATION_CONCURRENCY);
    assert.ok(s.classifications.filter(c => c.status === 'pending').length <= CLASSIFICATION_CONCURRENCY + CLASSIFICATION_QUEUE_LIMIT);
  } finally { await d.daemon.close(); await h.close(); delete process.env.HACHIDORI_ENDPOINT; }
});
