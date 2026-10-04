import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createYokodori, ContextCompileError } from '../dist/sdk/index.js';
import { snapshot } from '../dist/core/outbound.js';
const runtime = createYokodori();
const task = { id: 'issue-1', kind: 'task', content: 'Implement the boundary.' };
const instructions = [
  { id: 'b', kind: 'instructions', content: 'Test.' },
  { id: 'a', kind: 'instructions', content: 'Read.' },
];
const hash = value => createHash('sha256').update(value).digest('hex');
const fidelity = { boundary: 'fixture', providerEffective: true };
test('compiler ordering, bytes, section digests, and golden renderer', () => {
  const a = runtime.compile({ task, instructions });
  const b = runtime.compile({ task, instructions: [...instructions].reverse() });
  assert.deepEqual(a, b);
  assert.deepEqual(a, runtime.compile({ instructions: [...instructions].map(s => ({ content: s.content, kind: s.kind, id: s.id, digest: 'caller-metadata' })), task: { content: task.content, kind: task.kind, id: task.id } }));
  assert.equal(a.text, readFileSync(new URL('../fixtures/initial-context/basic.txt', import.meta.url), 'utf8'));
  assert.equal(a.digest, hash(a.text));
  assert.equal(a.sections[0].digest, hash(a.sections[0].content));
  const changed = runtime.compile({ task: { ...task, content: 'Changed.' }, instructions });
  assert.notEqual(a.digest, changed.digest);
  assert.equal(a.sections[0].digest, changed.sections[0].digest);
  assert.notEqual(a.sections[1].digest, changed.sections[1].digest);
});
test('duplicate identity has typed deterministic failure', () => {
  for (const sources of [instructions, [...instructions].reverse()])
    assert.throws(() => runtime.compile({ task, instructions: [...sources, { ...task, kind: 'instructions' }] }),
      error => error instanceof ContextCompileError && error.code === 'DUPLICATE_SOURCE' && error.sourceId === task.id);
});
test('volatile metadata does not affect semantic digest', () => {
  const message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'reason' }], timestamp: 1 };
  assert.equal(snapshot([message], 1, fidelity).digest, snapshot([{ ...message, timestamp: 900 }], 2, fidelity).digest);
  assert.notEqual(snapshot([{ role: 'assistant', content: [{ type: 'toolCall', arguments: { timestamp: 1 } }] }], 1, fidelity).digest,
    snapshot([{ role: 'assistant', content: [{ type: 'toolCall', arguments: { timestamp: 2 } }] }], 1, fidelity).digest);
  assert.equal(snapshot([{ role: 'user', content: [{ type: 'image', data: 'abc' }] }], 1, fidelity).complete, true);
  const opaque = snapshot([{ role: 'custom', content: { unsupported: () => 1 } }], 1, fidelity);
  assert.equal(opaque.complete, false);
  assert.deepEqual(opaque.messages[0].omittedFields, ['$.content.unsupported']);
  const rich = snapshot([
    { role: 'system', content: 'Protocol', toolsAdded: [{ name: 'read', description: 'Read' }] },
    { role: 'user', content: [{ type: 'text', text: 'See' }, { type: 'image', data: 'base64', mimeType: 'image/png' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'Consider' }, { type: 'toolCall', id: '1', name: 'read', arguments: { path: 'x' } }] },
    { role: 'toolResult', toolCallId: '1', content: [{ type: 'text', text: 'Evidence' }] },
    { role: 'custom', customType: 'notice', content: [{ type: 'text', text: 'Known' }] },
  ], 1, fidelity);
  assert.equal(rich.complete, true);
  assert.deepEqual(rich.messages.map(m => m.role), ['system', 'user', 'assistant', 'toolResult', 'custom']);
  assert.equal(rich.messages[2].payload.content[0].thinking, 'Consider');
  assert.equal(rich.messages[1].payload.content[1].data, 'base64');
  assert.equal(rich.stats.toolBytes > 0, true);
});
