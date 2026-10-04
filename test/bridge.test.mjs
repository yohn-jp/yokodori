import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from '../dist/daemon/server.js';
import { MAX_MESSAGE_TEXT_BYTES } from '../dist/protocol/observation.js';
import extension from '../dist/adapters/pi/package-extension.js';
const wait = async predicate => { for (let n = 0; n < 100; n++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out waiting for observation'); };
test('package Pi hooks emit bounded evidence; delivery failure never blocks context path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yokodori-bridge-'));
  const previous = process.env.YOKODORI_RUNTIME_DIR;
  process.env.YOKODORI_RUNTIME_DIR = dir;
  const daemon = createDaemon();
  const url = await daemon.listen();
  try {
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ url }));
    await mkdir(join(dir, '.yokodori'));
    await writeFile(join(dir, 'instructions.txt'), 'secret model-visible text');
    await writeFile(join(dir, '.yokodori/instruct.json'), JSON.stringify({ version: 1, context: [{ path: 'instructions.txt', kind: 'instructions', rank: 1 }] }));
    const handlers = new Map(); const notices = [];
    extension({ on: (name, handler) => handlers.set(name, handler), registerCommand: (_name, command) => handlers.set('command', command.handler) });
    await handlers.get('session_start')({}, { cwd: dir, ui: { notify: value => notices.push(value) } });
    const sections = {};
    handlers.get('before_agent_start')({ systemPromptOptions: { sections } });
    assert.match(sections.yokodori_initial_context, /secret model-visible text/);
    const injected = `<yokodori_initial_context>\n${sections.yokodori_initial_context}\n</yokodori_initial_context>`;
    handlers.get('context_with_system')({ messages: [{ role: 'system', sections: { yokodori_initial_context: injected } }] });
    await wait(async () => (await (await fetch(url + '/api/v1/events')).json()).some(e => e.kind === 'context.observed'));
    const events = await (await fetch(url + '/api/v1/events')).json();
    assert.deepEqual(events.filter(e => e.kind.startsWith('context.')).map(e => e.kind), ['context.compiled', 'context.injected', 'context.observed']);
    assert.equal(events.at(-1).payload.certification, 'MATCH');
    assert.doesNotMatch(JSON.stringify(events), /secret model-visible text/);
    const streams = await (await fetch(url + '/api/v1/streams')).json();
    assert.equal(streams.length, 1);
    handlers.get('context_with_system')({ messages: [] });
    await wait(async () => (await (await fetch(url + '/api/v1/events')).json()).some(e => e.payload.certification === 'MISMATCH'));
    await daemon.close();
    handlers.get('before_agent_start')({ systemPromptOptions: { sections: {} } });
    handlers.get('context_with_system')({ messages: [] });
    assert.doesNotThrow(() => handlers.get('message_end')({ message: { role: 'user', content: [{ type: 'text', text: 'daemon unavailable' }] } }));
    await handlers.get('command')('', { ui: { notify: value => notices.push(value) } });
    assert.equal(JSON.parse(notices.at(-1)).state, 'certification_failure');
  } finally {
    if (daemon.server.listening) await daemon.close();
    if (previous === undefined) delete process.env.YOKODORI_RUNTIME_DIR; else process.env.YOKODORI_RUNTIME_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pi final-message observation emits only bounded user and assistant text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yokodori-messages-'));
  const previous = process.env.YOKODORI_RUNTIME_DIR;
  process.env.YOKODORI_RUNTIME_DIR = dir;
  const daemon = createDaemon();
  const url = await daemon.listen();
  try {
    await writeFile(join(dir, 'endpoint.json'), JSON.stringify({ url }));
    const handlers = new Map();
    extension({ on: (name, handler) => { handlers.set(name, handler); return () => {}; }, registerCommand() {} });
    await handlers.get('session_start')({}, { cwd: dir, ui: { notify() {} } });
    handlers.get('message_end')({ message: { role: 'system', content: [{ type: 'text', text: 'hidden system prompt' }] } });
    handlers.get('message_end')({ message: { role: 'user', content: [
      { type: 'text', text: 'first part' }, { type: 'image', data: 'hidden image bytes' }, { type: 'text', text: 'second part' },
    ] } });
    handlers.get('message_end')({ message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'あ'.repeat(MAX_MESSAGE_TEXT_BYTES / 3 + 1) },
    ] } });
    await wait(async () => (await (await fetch(url + '/api/v1/streams')).json())[0]?.messageHistory?.retainedCount === 2);
    const snapshot = await (await fetch(url + '/api/v1/snapshot')).json();
    const stream = snapshot.streams[0];
    assert.deepEqual(stream.messages[0], { sequence: 2, observedAt: stream.messages[0].observedAt,
      role: 'user', text: 'first part\nsecond part', truncated: false });
    assert.deepEqual(stream.messages[1], { sequence: 3, observedAt: stream.messages[1].observedAt,
      role: 'assistant', text: 'あ'.repeat(MAX_MESSAGE_TEXT_BYTES / 3), truncated: true, originalBytes: MAX_MESSAGE_TEXT_BYTES + 1 });
    assert.equal(stream.messageHistory.truncatedCount, 1);
    assert.equal(stream.messageHistory.incomplete, true);
    assert.doesNotMatch(JSON.stringify(stream), /hidden system prompt|hidden image bytes|private reasoning/);
    assert.deepEqual(stream.events.filter(event => event.kind === 'message.observed').map(event => event.payload.role), ['user', 'assistant']);
  } finally {
    await daemon.close();
    if (previous === undefined) delete process.env.YOKODORI_RUNTIME_DIR; else process.env.YOKODORI_RUNTIME_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
