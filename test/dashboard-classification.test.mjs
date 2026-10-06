import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag = '') { this.tag = tag; this.children = []; this.listeners = new Map(); this._text = ''; this.dataset = {}; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  setAttribute(name, value) { this[name] = value; }
  querySelectorAll(tag) { return this.children.filter(child => child.tag === tag); }
  contains(node) { return this.children.includes(node); }
  focus() { this.focused = true; this.ownerDocument.activeElement = this; }
}
const ids = ['streams','current','repo','context','retention','timeline','conversation','message-inspector','execution-title','execution-meta','execution-status','execution-search','count-all','count-running','count-finished','filter-all','filter-running','filter-finished','tab-conversation','tab-timeline','tab-git','view-conversation','view-timeline','view-git','execution-evidence','current-state','health'];
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
  const document = { activeElement: null, getElementById: id => elements[id], createElement: tag => { const n = new Element(tag); n.ownerDocument = document; return n; }, createTextNode: text => { const n = new Element(); n.textContent = text; return n; } };
  Object.values(elements).forEach(node => { node.ownerDocument = document; });
  const context = { document, fetch: async path => { requests.push(path); return { ok: true, json: async () => snapshot }; },
    EventSource: class { constructor(path) { this.path = path; live = this; this.listeners = new Map(); } addEventListener(type, fn) { this.listeners.set(type, fn); } } };
  const script = await readFile(new URL('../dist/dashboard/dashboard.js', import.meta.url), 'utf8');
  await runInNewContext(script, context);
  return { elements, requests, live, update: async next => { snapshot = next; await live.listeners.get('update')(); } };
}

test('derived state, ordered related evidence and quiet health use retained observations', async () => {
  const a = stream('a', [message(10, 'A'), message(20, 'B')], [annotation(10, 'complete'), annotation(20, 'complete')]);
  a.messageHistory = { ...history, incomplete: false };
  a.events = [
    { kind: 'context.observed', sequence: 3 }, { kind: 'git.observed', sequence: 4 },
    { kind: 'context.observed', sequence: 8 }, { kind: 'git.observed', sequence: 9 },
    { kind: 'context.observed', sequence: 21 }, { kind: 'git.observed', sequence: 22 },
  ];
  const h = await harness({ streams: [a] });
  assert.match(h.elements['current-state'].textContent, /Execution · stream stateActive.*Activity · latest classification #20implement.*Context.*Certified.*Conversation.*user.*Git.*Clean/);
  assert.equal(h.elements.health.textContent, 'Healthy · No observed issues');
  click(buttons(h.elements)[0]);
  const related = h.elements['message-inspector'].children.find(node => node.className === 'related-evidence');
  assert.match(related.textContent, /Selected message#10Attached classificationmessage:id-10 · complete · source #10/);
  assert.match(related.textContent, /Preceding context observation#8.*Preceding Git observation#9.*Next retained message#20/);
  assert.doesNotMatch(related.textContent, /#21|#22|caused by/i);
  assert.equal(h.elements['view-conversation'].hidden, false);
});

test('missing evidence stays absent; observed anomalies retain distinct source states', async () => {
  const a = stream('a', [message(2, 'A', true), message(3, 'B')], [annotation(2, 'unavailable'), annotation(3, 'failed')]);
  a.latest = {};
  a.messageHistory = { ...history };
  const h = await harness({ streams: [a] });
  assert.doesNotMatch(h.elements['current-state'].textContent, /Activity|Context|Git/);
  assert.match(h.elements.health.textContent, /Message historyIncomplete.*Message truncationRetained message #2.*Hachidori classificationfailed/);
  click(buttons(h.elements)[0]);
  assert.match(h.elements.health.textContent, /unavailable/);
  assert.doesNotMatch(h.elements.health.textContent, /0%/);
  a.latest = { 'context.observed': { sequence: 7, payload: { certification: 'MISMATCH', complete: false } },
    'git.observed': { sequence: 8, payload: { dirty: 'dirty' } } };
  await h.update({ streams: [a] });
  assert.match(h.elements.health.textContent, /Context certificationMISMATCH.*Context completenessPartial.*Git observationDirty/);
  assert.match(h.elements['current-state'].textContent, /Context · observation #7Partial.*Git · latest observationDirty/);
});

test('message collection, complete low-confidence chips and modeless per-axis inspector', async () => {
  const a = stream('a', [message(2, 'first'), message(3, 'second', true)], [annotation(2, 'complete',
    { classifier: { schema: 'hachidori.v1', model: 'm', provider: 'p' }, timing: { inferenceMs: 4, totalMs: 7 } }), annotation(3, 'pending')]);
  const h = await harness({ streams: [a, stream('b', [])] }); const { elements } = h;
  assert.equal(elements.streams.children[0]['aria-current'], 'true');
  assert.match(elements.conversation.textContent, /activity: implement/);
  const lowChip = buttons(elements)[0].children[0].children.at(-1).children[0];
  assert.match(lowChip.className, /low-emphasis/);
  assert.match(lowChip.title, /34%/);
  assert.match(elements.conversation.textContent, /execution_state: implementation/);
  assert.match(elements.conversation.textContent, /Classification pending/);
  assert.match(elements.conversation.textContent, /Truncated/);
  assert.match(elements.retention.textContent, /IncompleteHistory/);
  assert.match(elements.repo.textContent, /Root\/repoBranchmain/);
  assert.match(elements.context.textContent, /ObservedCompleteCertificationMATCH/);
  click(buttons(elements)[0]);
  assert.match(elements['message-inspector'].textContent, /StatusComplete/);
  assert.match(elements['message-inspector'].textContent, /message@1/);
  assert.match(elements['message-inspector'].textContent, /ModelmProviderpInference4 msTotal7 ms/);
  assert.equal(elements['message-inspector'].children.filter(node => node.className === 'axis-detail').length, 4);
  const firstAxis = elements['message-inspector'].children.find(node => node.className === 'axis-detail');
  assert.match(firstAxis.textContent, /implement34%test33%other33%/);
  assert.equal(firstAxis.children[1].children[1].value, .34);
  assert.match(elements.conversation.textContent, /first.*second/s);
  assert.match(elements.current.textContent, /a/);
  click(buttons(elements)[1]);
  assert.match(elements['message-inspector'].textContent, /pendingNo inferred choices/);
  assert.doesNotMatch(elements['message-inspector'].textContent, /implement|instruction/);
  assert.match(elements.current.textContent, /a/);
  assert.deepEqual(h.requests, ['/api/v1/snapshot']);
});

test('failed, unavailable, absent metadata and no classification do not invent semantic values', async () => {
  const a = stream('a', [message(2, 'A'), message(3, 'B'), message(4, 'C'), message(5, 'D')],
    [annotation(2, 'unavailable', { failure: 'NOT_READY' }), annotation(3, 'failed', { failure: 'INVALID_RESPONSE' }), annotation(4, 'complete')]);
  const h = await harness({ streams: [a] });
  const pane = h.elements['message-inspector'];
  for (const [index, state, failure] of [[0, 'unavailable', 'NOT_READY'], [1, 'failed', 'INVALID_RESPONSE']]) {
    click(buttons(h.elements)[index]);
    assert.match(pane.textContent, new RegExp(state + failure));
    assert.doesNotMatch(pane.textContent, /No choice|implement|instruction/);
  }
  click(buttons(h.elements)[2]);
  assert.match(pane.textContent, /StatusComplete/);
  assert.doesNotMatch(pane.textContent, /undefined|Model|Provider|Inference|Total/);
  click(buttons(h.elements)[3]);
  assert.match(pane.textContent, /No classification observation/);
  assert.match(h.elements.conversation.textContent, /D/);
});

test('classification state does not repeat an identical failure token', async () => {
  const a = stream('a', [message(2, 'A')], [annotation(2, 'unavailable', { failure: 'UNAVAILABLE' })]);
  const h = await harness({ streams: [a] });
  click(buttons(h.elements)[0]);
  const pane = h.elements['message-inspector'];
  assert.match(pane.textContent, /unavailable/);
  assert.doesNotMatch(pane.textContent, /UNAVAILABLE/);
});

test('first-party responsive layout keeps the document in one column at narrow widths', async () => {
  const css = await readFile(new URL('../dist/dashboard/dashboard.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dist/dashboard/index.html', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.workspace \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.execution-list \{ display: flex; overflow-x: auto;/);
  assert.match(css, /\.message-shell \{[^}]*display: block/);
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


test('execution search/filter and center tabs preserve modeless navigation', async () => {
  const running = stream('run-1', [message(2, 'running')], [annotation(2, 'complete')]);
  running.latest['git.observed'].payload.root = '/src/yokodori';
  running.latest['git.observed'].payload.branch = 'feat/live';
  const finished = stream('done-1', [message(2, 'finished')], [annotation(2, 'complete')]);
  finished.closed = true;
  finished.latest['git.observed'].payload.root = '/src/matagi';
  finished.latest['git.observed'].payload.branch = 'main';

  const h = await harness({ streams: [running, finished] });
  const { elements } = h;

  assert.equal(elements['count-all'].textContent, '2');
  assert.equal(elements['count-running'].textContent, '1');
  assert.equal(elements['count-finished'].textContent, '1');
  assert.equal(elements['view-conversation'].hidden, false);
  assert.equal(elements['view-timeline'].hidden, true);

  elements['filter-finished'].listeners.get('click')();
  assert.equal(elements.streams.children.length, 1);
  assert.match(elements.current.textContent, /done-1/);
  assert.match(elements['execution-status'].textContent, /Finished/);

  elements['filter-all'].listeners.get('click')();
  elements['execution-search'].value = 'yokodori';
  elements['execution-search'].listeners.get('input')({ target: elements['execution-search'] });
  assert.equal(elements.streams.children.length, 1);
  assert.match(elements['execution-title'].textContent, /yokodori/);

  elements['tab-git'].listeners.get('click')();
  assert.equal(elements['view-conversation'].hidden, true);
  assert.equal(elements['view-git'].hidden, false);
  assert.equal(elements['tab-git']['aria-selected'], 'true');

  await h.update({ streams: [running, finished] });
  assert.equal(elements['view-git'].hidden, false);
  assert.match(elements.current.textContent, /run-1/);
});


test('execution ordering, recency, filters, keyboard and SSE selection use canonical observations', async () => {
  const at = (id, time, closed = false) => {
    const s = stream(id, [message(2, id)]);
    s.closed = closed;
    s.latest['git.observed'].payload.branch = 'trunk';
    s.messages[0].observedAt = time;
    return s;
  };
  const old = '2026-01-01T00:00:00Z';
  const recent = new Date(Date.now() - 2 * 60000).toISOString();
  const a = at('a', old), b = at('b', recent), c = at('c', recent, true), d = at('d', old, true), e = at('e', old);
  const h = await harness({ streams: [d, e, c, b, a] });
  const { elements } = h;
  const order = () => elements.streams.children.map(node => node.dataset.streamId);
  assert.deepEqual(order(), ['b', 'a', 'e', 'c', 'd']);
  const time = elements.streams.children[0].children[2].children[1];
  assert.equal(time.textContent, '2m');
  assert.equal(time.title, recent);
  assert.equal(time.datetime, recent);
  assert.match(elements.streams.children[3].className, /finished/);
  const nav = (index, key) => {
    const target = elements.streams.children[index];
    elements.streams.listeners.get('keydown')({ key, target, preventDefault() {} });
  };
  nav(0, 'ArrowDown');
  assert.match(elements.current.textContent, /a/);
  assert.equal(elements.streams.children[1].focused, true);
  nav(1, 'ArrowUp');
  assert.match(elements.current.textContent, /b/);
  nav(0, 'End');
  assert.match(elements.current.textContent, /d/);
  nav(4, 'Home');
  assert.match(elements.current.textContent, /b/);
  click(buttons(elements)[0]);
  click(elements['tab-git']);
  b.messages[0].observedAt = new Date(Date.now() - 60000).toISOString();
  await h.update({ streams: [d, a, c, e, b] });
  assert.match(elements.current.textContent, /b/);
  assert.equal(buttons(elements)[0]['aria-pressed'], 'true');
  assert.equal(elements['view-git'].hidden, false);
  elements['filter-finished'].listeners.get('click')();
  assert.deepEqual(order(), ['c', 'd']);
  nav(0, 'End');
  assert.match(elements.current.textContent, /d/);
  elements['filter-running'].listeners.get('click')();
  assert.deepEqual(order(), ['b', 'a', 'e']);
  elements['filter-all'].listeners.get('click')();
  elements['execution-search'].value = 'a';
  elements['execution-search'].listeners.get('input')({ target: elements['execution-search'] });
  assert.deepEqual(order(), ['a']);
  await h.update({ streams: [d, e, c, b] });
  assert.equal(elements.streams.children[0].className, 'execution-empty');
  assert.match(elements.streams.textContent, /No executions match/);
});

test('missing observation time is not fabricated and identity breaks time ties', async () => {
  const a = stream('a', []), b = stream('b', []);
  a.latest = {}; b.latest = {};
  const h = await harness({ streams: [b, a] });
  assert.deepEqual(h.elements.streams.children.map(node => node.dataset.streamId), ['a', 'b']);
  assert.equal(h.elements.streams.children[0].children[2].children.length, 1);
  const css = await readFile(new URL('../dist/dashboard/dashboard.css', import.meta.url), 'utf8');
  assert.match(css, /\.execution-item\.finished \{[^}]*padding-top: 7px;[^}]*color: var\(--muted\)/);
});
