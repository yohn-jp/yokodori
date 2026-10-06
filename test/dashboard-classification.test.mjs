import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag = '') { this.tag = tag; this.children = []; this.listeners = new Map(); this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  setAttribute(name, value) { this[name] = value; }
}
const ids = ['streams','current','repo','context','retention','timeline','conversation','message-inspector','execution-title','execution-meta'];
const axes = [
  { id: 'activity', choice: 'implement', confidence: .34, probabilities: { implement: .34, test: .33, other: .33 } },
  { id: 'intent', choice: 'instruction', confidence: 1, probabilities: { instruction: 1, other: 0 } },
  { id: 'domain', choice: 'ui', confidence: 1, probabilities: { ui: 1, other: 0 } },
  { id: 'execution_state', choice: 'implementation', confidence: 1, probabilities: { implementation: 1, other: 0 } },
];
const message = (sequence, text, truncated = false) => ({ sequence, observedAt: '2026-01-01T00:00:00Z', role: 'user', text, truncated });
const annotation = (sequence, status, extra = {}) => ({ classificationId: `message:id-${sequence}`, sourceEventId: `id-${sequence}`, sourceSequence: sequence,
  profile: { id: 'message', version: 1 }, status, observedAt: '2026-01-01T00:00:00Z',
  axes: status === 'complete' ? axes : axes.map(({ id }) => ({ id })), ...extra });
const history = { retainedCount: 4, evictedCount: 2, truncatedCount: 1, incomplete: true };
const stream = (streamId, messages, classifications = []) => ({ streamId, sequence: messages.at(-1)?.sequence ?? 1, closed: false, messages, classifications,
  messageHistory: history, events: [], latest: { 'git.observed': { payload: { root: '/repo', branch: 'main', head: 'a'.repeat(40), dirty: 'clean' } },
    'context.compiled': { payload: { sourceCount: 2, digest: 'a'.repeat(64) } }, 'context.injected': {},
    'context.observed': { payload: { certification: 'MATCH', complete: true } } } });
const click = node => node.listeners.get('click')();
const buttons = elements => elements.conversation.children[0].children.map(item => item.children[0]);
async function harness(initial) {
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  let snapshot = initial; let live; const requests = [];
  const document = { getElementById: id => elements[id], createElement: tag => new Element(tag), createTextNode: text => { const n = new Element(); n.textContent = text; return n; } };
  const context = { document, fetch: async path => { requests.push(path); return { ok: true, json: async () => snapshot }; },
    EventSource: class { constructor(path) { this.path = path; live = this; this.listeners = new Map(); } addEventListener(type, fn) { this.listeners.set(type, fn); } } };
  const script = await readFile(new URL('../dist/dashboard/dashboard.js', import.meta.url), 'utf8');
  await runInNewContext(script, context);
  return { elements, requests, live, update: async next => { snapshot = next; await live.listeners.get('update')(); } };
}

test('message collection, complete low-confidence chips and modeless per-axis inspector', async () => {
  const a = stream('a', [message(2, 'first'), message(3, 'second', true)], [annotation(2, 'complete',
    { classifier: { schema: 'hachidori.v1', model: 'm', provider: 'p' }, timing: { inferenceMs: 4, totalMs: 7 } }), annotation(3, 'pending')]);
  const h = await harness({ streams: [a, stream('b', [])] }); const { elements } = h;
  assert.equal(elements.streams.children[0]['aria-current'], 'true');
  assert.match(elements.conversation.textContent, /activity: implement/);
  const lowChip = buttons(elements)[0].children.at(-1).children[0];
  assert.match(lowChip.className, /low-emphasis/);
  assert.match(lowChip.title, /34%/);
  assert.match(elements.conversation.textContent, /execution_state: implementation/);
  assert.match(elements.conversation.textContent, /Classification pending/);
  assert.match(elements.conversation.textContent, /Truncated/);
  assert.match(elements.retention.textContent, /incomplete history/);
  assert.match(elements.repo.textContent, /\/repo · main/);
  assert.match(elements.context.textContent, /MATCH · complete/);
  click(buttons(elements)[0]);
  assert.match(elements['message-inspector'].textContent, /Statuscomplete/);
  assert.match(elements['message-inspector'].textContent, /message@1/);
  assert.match(elements['message-inspector'].textContent, /ModelmProviderpInference4 msTotal7 ms/);
  assert.equal(elements['message-inspector'].children.filter(node => node.className === 'axis-detail').length, 4);
  const firstAxis = elements['message-inspector'].children.find(node => node.className === 'axis-detail');
  assert.match(firstAxis.textContent, /implement34%test33%other33%/);
  assert.equal(firstAxis.children[1].children[1].value, .34);
  assert.match(elements.conversation.textContent, /first.*second/s);
  assert.match(elements.current.textContent, /a/);
  click(buttons(elements)[1]);
  assert.match(elements['message-inspector'].textContent, /Classification pending · no inferred choices/);
  assert.doesNotMatch(elements['message-inspector'].textContent, /implement|instruction/);
  assert.match(elements.current.textContent, /a/);
  assert.deepEqual(h.requests, ['/api/v1/snapshot']);
});

test('failed, unavailable, absent metadata and no classification do not invent semantic values', async () => {
  const a = stream('a', [message(2, 'A'), message(3, 'B'), message(4, 'C'), message(5, 'D')],
    [annotation(2, 'unavailable', { failure: 'NOT_READY' }), annotation(3, 'failed', { failure: 'INVALID_RESPONSE' }), annotation(4, 'complete')]);
  const h = await harness({ streams: [a] });
  const pane = h.elements['message-inspector'];
  for (const [index, state] of [[0, 'unavailable'], [1, 'failed']]) {
    click(buttons(h.elements)[index]);
    assert.match(pane.textContent, new RegExp(`Classification ${state} · no inferred choices`));
    assert.doesNotMatch(pane.textContent, /implement|instruction/);
  }
  click(buttons(h.elements)[2]);
  assert.match(pane.textContent, /Statuscomplete/);
  assert.doesNotMatch(pane.textContent, /undefined|Model|Provider|Inference|Total/);
  click(buttons(h.elements)[3]);
  assert.match(pane.textContent, /No classification observation/);
  assert.match(h.elements.conversation.textContent, /D/);
});

test('first-party responsive layout keeps the document in one column at narrow widths', async () => {
  const css = await readFile(new URL('../dist/dashboard/dashboard.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dist/dashboard/index.html', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 700px\)\s*\{[\s\S]*?\.workspace \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.execution-list \{ display: flex; overflow-x: auto;/);
  assert.match(css, /\.message-text \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('snapshot/SSE recovery preserves surviving selection; eviction, stream removal and empty stream fall back deterministically', async () => {
  const a = stream('a', [message(2, 'A'), message(3, 'B')], [annotation(2, 'complete'), annotation(3, 'pending')]);
  const b = stream('b', []);
  const h = await harness({ streams: [a, b] });
  click(buttons(h.elements)[1]);
  await h.update({ streams: [a, b] });
  assert.equal(buttons(h.elements)[1]['aria-pressed'], 'true');
  assert.match(h.elements['message-inspector'].textContent, /Message #3/);
  await h.update({ streams: [stream('a', [message(2, 'A')], [annotation(2, 'complete')]), b] });
  assert.match(h.elements['message-inspector'].textContent, /Select a message/);
  assert.equal(buttons(h.elements)[0]['aria-pressed'], 'false');
  click(h.elements.streams.children[1]);
  assert.match(h.elements.conversation.textContent, /No retained conversation observations yet/);
  await h.update({ streams: [a, b] });
  assert.match(h.elements.current.textContent, /b/);
  await h.update({ streams: [a] });
  assert.match(h.elements.current.textContent, /a/);
  assert.match(h.elements['message-inspector'].textContent, /Select a message/);
  await h.update({ streams: [] });
  assert.match(h.elements.streams.textContent, /No executions observed yet/);
  assert.match(h.elements['message-inspector'].textContent, /No execution selected/);
  assert.ok(h.requests.every(path => path === '/api/v1/snapshot'));
});
