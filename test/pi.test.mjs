import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createYokodori, ContextCompileError } from '../dist/sdk/index.js';
import { createPiExtension, PiAdapterError, IncompleteTranscriptError } from '../dist/adapters/pi/index.js';
import { snapshot } from '../dist/core/outbound.js';
import { canonical } from '../dist/language/canonical.js';
import { createHash } from 'node:crypto';
const fidelity = { boundary: 'pi.context_with_system', providerEffective: false };

const model = { id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'yokodori-fixture',
  baseUrl: 'https://invalid.example', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false, contextWindow: 100000, maxTokens: 1000 };
const input = { task: { id: 'issue', kind: 'task', content: 'Implement.' } };
async function run(mode, observe = true, fail = false, certification = 'strict') {
  const received = [], captured = [], notifications = [];
  const runtime = createYokodori({ observer: { onOutboundContext(s) {
    captured.push(s);
    if (fail) throw new Error('observer unavailable');
  } } });
  const attachment = observe ? await createPiExtension({ runtime, injection: mode, initialContext: () => input,
    certification, onObservationFailure: failure => notifications.push(failure) }) : undefined;
  const cwd = process.cwd();
  const settingsManager = SettingsManager.inMemory({ defaultTools: [] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager, noExtensions: true,
    noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    systemPrompt: 'Base system', extensionFactories: [
      { name: 'fixture-context', factory: pi => pi.on('context', event => ({ messages: [
        ...event.messages, { role: 'custom', customType: 'fixture', content: [{ type: 'text', text: 'after context' }], display: false, timestamp: 0 },
      ] })) },
      ...(attachment ? [{ name: 'yokodori', factory: attachment.extension }] : []),
    ] });
  await loader.reload();
  const modelRuntime = await ModelRuntime.create();
  modelRuntime.registerNativeProvider({ id: model.provider, name: 'Fixture',
    auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } },
    getModels: () => [model], stream: stream, streamSimple: stream });
  function stream(_model, context) {
    received.push(context);
    const result = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: model.api,
      provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now() };
    queueMicrotask(() => { result.push({ type: 'done', reason: 'stop', message }); result.end(message); });
    return result;
  }
  const { session } = await createAgentSession({ cwd, model, modelRuntime, settingsManager,
    sessionManager: SessionManager.inMemory(cwd), resourceLoader: loader, noTools: true });
  await session.bindExtensions({});
  try {
    await session.prompt('First');
    await session.prompt('Second');
  } finally { session.dispose(); }
  return { received, captured, attachment, notifications, compiled: runtime.compile(input) };
}
test('supported resource loader and actual Pi seam: passive provider equivalence, sequence and digest', async () => {
  const bare = await run('control', false);
  const tapped = await run('control');
  assert.equal(bare.received.length, 2);
  assert.equal(tapped.captured.length, 2);
  assert.deepEqual(tapped.captured.map(s => s.requestSequence), [1, 2]);
  assert.deepEqual(tapped.received.map(s => snapshot(s.messages, 0, fidelity).messages), bare.received.map(s => snapshot(s.messages, 0, fidelity).messages));
  assert.equal(tapped.captured[0].digest, createHash('sha256').update(canonical(tapped.captured[0].messages.map(m => ({ role: m.role, payload: m.payload, complete: m.complete, omittedFields: [...m.omittedFields] })))).digest('hex'));
  assert.deepEqual(tapped.captured[0].fidelity, fidelity);
  assert.equal(tapped.captured[0].messages[0].role, 'system');
  assert.ok(tapped.captured[0].messages.some(m => m.role === 'custom' && m.payload.customType === 'fixture'));
});
test('append and explicit replace', async () => {
  const appended = await run('append');
  assert.ok(appended.captured[0].messages.some(m => JSON.stringify(m.payload).includes(appended.compiled.text.replaceAll('\n', '\\n'))));
  assert.ok(appended.received[0].messages.some(m => JSON.stringify(m).includes(JSON.stringify(appended.compiled.text).slice(1, -1))), JSON.stringify(appended.received[0].messages).slice(0, 500));
  assert.deepEqual(appended.captured[0].fidelity, fidelity);
  assert.ok(JSON.stringify(appended.received[0]).includes('Base system'));
  const replaced = await run('replace');
  assert.deepEqual(replaced.captured[0].fidelity, { boundary: 'pi.context_with_system', providerEffective: false, knownPostBoundaryProjection: 'forced-system-prompt' });
  assert.ok(replaced.received[0].messages.some(m => m.role === 'system' && m.content === replaced.compiled.text));
  assert.ok(!JSON.stringify(replaced.received[0]).includes('Base system'));
});
test('missing supported Pi extension API fails attachment explicitly', async () => {
  const attachment = await createPiExtension({ runtime: createYokodori(), injection: 'control' });
  assert.throws(() => attachment.extension({}), error => error instanceof PiAdapterError && error.code === 'INCOMPATIBLE_PI');
  assert.throws(() => attachment.extension({ on() {} }), error => error instanceof PiAdapterError && error.code === 'INCOMPATIBLE_PI');
});
test('strict certification records incomplete transcript without replacement', async () => {
  const handlers = new Map();
  const captured = [];
  const attachment = await createPiExtension({ runtime: createYokodori({ observer: {
    onOutboundContext: value => captured.push(value),
  } }), injection: 'control', certification: 'strict' });
  attachment.extension({ on: (name, handler) => { handlers.set(name, handler); return () => {}; } });
  handlers.get('session_start')();
  const result = await handlers.get('context_with_system')({ messages: [{ role: 'custom', content: { opaque: () => 1 } }] });
  assert.equal(result, undefined);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].complete, false);
  assert.equal(attachment.status().certifiable, false);
  assert.ok(attachment.status().failures[0].error instanceof IncompleteTranscriptError);
});
test('compiler rejects before Pi attachment or model execution', async () => {
  await assert.rejects(createPiExtension({ runtime: createYokodori(), initialContext: async () => ({
    task: input.task, instructions: [{ ...input.task, kind: 'instructions' }],
  }) }), error => error instanceof ContextCompileError && error.code === 'DUPLICATE_SOURCE');
});
test('observer failure is visible and uncertifiable, but cannot change provider request', async () => {
  const clean = await run('control');
  const failed = await run('control', true, true);
  assert.deepEqual(failed.received.map(s => snapshot(s.messages, 0, fidelity).messages), clean.received.map(s => snapshot(s.messages, 0, fidelity).messages));
  assert.equal(failed.notifications.length, 2);
  assert.equal(failed.attachment.status().certifiable, false);
  assert.equal(failed.attachment.status().failures.length, 2);
  const defaultPolicy = await run('control', true, true, 'default');
  assert.equal(defaultPolicy.received.length, 2);
  assert.equal(defaultPolicy.notifications.length, 2);
  assert.equal(defaultPolicy.attachment.status().certifiable, undefined);
  assert.equal(defaultPolicy.attachment.status().failures.length, 2);
});
