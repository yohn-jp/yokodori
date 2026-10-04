import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createDaemon } from '../dist/daemon/server.js';
import extension from '../dist/adapters/pi/package-extension.js';

const wait = async predicate => {
  for (let n = 0; n < 100; n++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for Pi message observations');
};

test('supported Pi message_end hook observes final user and assistant messages', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yokodori-pi-message-end-'));
  const previousRuntimeDir = process.env.YOKODORI_RUNTIME_DIR;
  process.env.YOKODORI_RUNTIME_DIR = cwd;
  const daemon = createDaemon();
  const url = await daemon.listen();
  let session;
  try {
    await writeFile(join(cwd, 'endpoint.json'), JSON.stringify({ url }));
    const model = {
      id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'yokodori-message-fixture',
      baseUrl: 'https://invalid.example', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: true, contextWindow: 100000, maxTokens: 1000,
    };
    const settingsManager = SettingsManager.inMemory({ defaultTools: [] });
    const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager, noExtensions: true,
      noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      extensionFactories: [{ name: 'yokodori-package', factory: extension }] });
    await loader.reload();
    const modelRuntime = await ModelRuntime.create();
    const providerStream = () => {
      const result = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [
        { type: 'thinking', thinking: 'private fixture reasoning' },
        { type: 'text', text: 'Final assistant answer' },
      ], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now() };
      queueMicrotask(() => { result.push({ type: 'done', reason: 'stop', message }); result.end(message); });
      return result;
    };
    modelRuntime.registerNativeProvider({ id: model.provider, name: 'Fixture',
      auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } },
      getModels: () => [model], stream: providerStream, streamSimple: providerStream,
    });
    ({ session } = await createAgentSession({ cwd, model, modelRuntime, settingsManager,
      sessionManager: SessionManager.inMemory(cwd), resourceLoader: loader, noTools: true }));
    await session.bindExtensions({});
    await session.prompt('Final user question');
    await wait(async () => {
      const streams = await (await fetch(url + '/api/v1/streams')).json();
      return streams[0]?.messageHistory?.retainedCount === 2;
    }).catch(async error => {
      const events = await (await fetch(url + '/api/v1/events')).json();
      throw new Error(`${error.message}; accepted event kinds: ${events.map(event => `${event.sequence}:${event.kind}`).join(',')}`);
    });
    const snapshot = await (await fetch(url + '/api/v1/snapshot')).json();
    const stream = snapshot.streams[0];
    assert.deepEqual(stream.messages.map(({ sequence, role, text, truncated }) => ({ sequence, role, text, truncated })), [
      { sequence: 2, role: 'user', text: 'Final user question', truncated: false },
      { sequence: 3, role: 'assistant', text: 'Final assistant answer', truncated: false },
    ]);
    assert.doesNotMatch(JSON.stringify(stream), /private fixture reasoning|Base system/);
  } finally {
    session?.dispose();
    await daemon.close();
    if (previousRuntimeDir === undefined) delete process.env.YOKODORI_RUNTIME_DIR;
    else process.env.YOKODORI_RUNTIME_DIR = previousRuntimeDir;
    await rm(cwd, { recursive: true, force: true });
  }
});
