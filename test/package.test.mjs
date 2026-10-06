import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { snapshot } from '../dist/core/outbound.js';
import { digest } from '../dist/language/canonical.js';
import { loadInstructions } from '../dist/adapters/pi/instruct.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fidelity = { boundary: 'pi.context_with_system', providerEffective: false };
const model = {
  id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'yokodori-package-fixture',
  baseUrl: 'https://invalid.example', input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false, contextWindow: 100000, maxTokens: 1000,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function runAsync(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', code => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(`${command} ${args.join(' ')} failed (${code}):\n${stdout}\n${stderr}`));
    });
  });
}

async function capturedProviderContext({ cwd, agentDir, withPackage, expectedState, afterStart, onProof, tamper }) {
  const received = [];
  const settingsManager = withPackage
    ? SettingsManager.create(cwd, agentDir)
    : SettingsManager.inMemory({ defaultTools: [] });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: !withPackage,
    noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  });
  await resourceLoader.reload();
  if (withPackage) {
    const loaded = resourceLoader.getExtensions();
    const extension = loaded.extensions.find(({ path }) => path.endsWith('package-extension.js'));
    assert.ok(extension, 'Pi did not discover the packed manifest entrypoint');
    assert.ok(extension.commands.has('yokodori'), 'Pi did not load the admission command');
    assert.ok(extension.handlers.has('before_agent_start'));
    assert.ok(extension.handlers.has('context_with_system'));
    assert.deepEqual(loaded.errors, []);
    assert.equal((loaded.warnings ?? []).some(({ warning }) => warning.includes('duplicate runtime modules')), false);
  }

  const modelRuntime = await ModelRuntime.create();
  const stream = (_selectedModel, context) => {
    received.push(context);
    const result = createAssistantMessageEventStream();
    const message = {
      role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: model.api,
      provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    };
    queueMicrotask(() => { result.push({ type: 'done', reason: 'stop', message }); result.end(message); });
    return result;
  };
  modelRuntime.registerNativeProvider({
    id: model.provider, name: 'Fixture',
    auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } },
    getModels: () => [model], stream, streamSimple: stream,
  });
  const { session } = await createAgentSession({
    cwd, model, modelRuntime, settingsManager,
    sessionManager: SessionManager.inMemory(cwd), resourceLoader, noTools: true,
  });
  await session.bindExtensions({});
  try {
    if (afterStart) await afterStart();
    await session.prompt('Package first ordinary request');
    if (withPackage) {
      const extension = resourceLoader.getExtensions().extensions.find(({ path }) => path.endsWith('package-extension.js'));
      if (tamper) {
        const section = received[0].messages[0].sections.yokodori_initial_context;
        await extension.handlers.get('context_with_system')[0]({ messages: [{ role: 'system', content: '',
          sections: { yokodori_initial_context: section.replace('Source: file:AGENTS.md', 'Source: file:tampered.md') } }] });
      }
      const notices = [];
      await extension.commands.get('yokodori').handler('', { ui: { notify: text => notices.push(JSON.parse(text)) } });
      const proof = notices[0];
      assert.equal(proof.state, expectedState, JSON.stringify(proof));
      if (expectedState === 'observed') {
        assert.equal(proof.boundary, 'pi.context_with_system');
        assert.equal(proof.requestSequence, 1);
        assert.equal(proof.complete, true);
        assert.equal(proof.matched, true);
        assert.equal(proof.compiledDigest, proof.observedInjectedDigest);
      }
      assert.equal(JSON.stringify(proof).includes('secret declared text'), false);
      onProof?.(proof);
    }
  } finally {
    session.dispose();
  }
  assert.equal(received.length, 1);
  return snapshot(received[0].messages, 0, fidelity).messages;
}

test('packed npm artifact: manifest admission before first request and observed section identity', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'yokodori-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const packOutput = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: root, encoding: 'utf8',
  });
  const packed = JSON.parse(packOutput)[0];
  const tarball = join(temporary, packed.filename);
  const contents = packed.files.map(({ path }) => path);
  assert.ok(contents.includes('package.json'));
  assert.ok(contents.includes('dist/adapters/pi/package-extension.js'));
  assert.ok(contents.includes('dist/adapters/pi/package-extension.d.ts'));
  assert.ok(contents.includes('dist/sdk/index.js'));
  assert.ok(contents.includes('dist/adapters/pi/index.js'));

  const consumer = join(temporary, 'sdk-consumer');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, tarball], { cwd: root });
  const manifest = JSON.parse(await readFile(join(consumer, 'node_modules/yokodori/package.json'), 'utf8'));
  assert.equal(manifest.version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
  assert.deepEqual(manifest.pi.extensions, ['./dist/adapters/pi/package-extension.js']);
  assert.equal(manifest.bin.yokodori, 'dist/daemon/cli.js');
  const executable = join(consumer, 'node_modules/.bin/yokodori');
  assert.match(run(executable, ['--help'], { cwd: consumer }), /Usage: yokodori daemon/);
  assert.equal(run(executable, ['--version'], { cwd: consumer }).trim(), manifest.version);
  assert.equal(manifest.peerDependencies['@earendil-works/pi-coding-agent'], '*');
  assert.equal(manifest.peerDependenciesMeta['@earendil-works/pi-coding-agent'].optional, true);
  const importCheck = run(process.execPath, ['--input-type=module', '-e',
    "import { createYokodori } from 'yokodori'; import { createPiExtension } from 'yokodori/pi'; if (typeof createYokodori !== 'function' || typeof createPiExtension !== 'function') process.exit(1);"],
  { cwd: consumer });
  assert.equal(importCheck, '');
  assert.equal(existsSync(join(consumer, 'node_modules/@earendil-works/pi-coding-agent')), false,
    'an SDK-only npm install must not acquire the optional Pi host runtime');

  const bytes = await readFile(tarball);
  const packageRoot = join(temporary, 'pi-agent');
  const project = join(temporary, 'pi-project');
  await Promise.all([
    mkdir(packageRoot, { recursive: true }), mkdir(project, { recursive: true }),
  ]);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/yokodori') {
      const address = `http://127.0.0.1:${server.address().port}/yokodori/-/${packed.filename}`;
      const packageMetadata = {
        ...manifest,
        dist: {
          tarball: address,
          shasum: createHash('sha1').update(bytes).digest('hex'),
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        },
      };
      response.writeHead(200, { 'content-type': 'application/vnd.npm.install-v1+json' });
      response.end(JSON.stringify({ name: manifest.name, 'dist-tags': { latest: manifest.version }, versions: { [manifest.version]: packageMetadata } }));
      return;
    }
    if (url.pathname === `/yokodori/-/${packed.filename}`) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      response.end(bytes);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));

  const agentEnvironment = {
    ...process.env,
    PI_CODING_AGENT_DIR: packageRoot,
    npm_config_registry: `http://127.0.0.1:${server.address().port}`,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_fetch_retries: '0',
    npm_config_fetch_timeout: '15000',
  };
  const piCli = join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
  const installOutput = await runAsync(process.execPath, [piCli, 'install', `npm:yokodori@${manifest.version}`], {
    cwd: project, env: agentEnvironment,
  });
  assert.ok(installOutput.includes(`Installed npm:yokodori@${manifest.version}`));
  const installedPackage = join(packageRoot, 'npm/node_modules/yokodori');
  assert.ok(existsSync(join(installedPackage, 'dist/adapters/pi/package-extension.js')));
  assert.equal(existsSync(join(packageRoot, 'npm/node_modules/@earendil-works/pi-coding-agent')), false);
  assert.equal(existsSync(join(installedPackage, 'node_modules/@earendil-works/pi-coding-agent')), false);

  const baseline = await capturedProviderContext({ cwd: project, agentDir: join(temporary, 'baseline-agent'), withPackage: false });
  const packaged = await capturedProviderContext({ cwd: project, agentDir: packageRoot, withPackage: true, expectedState: 'unconfigured' });
  assert.deepEqual(packaged, baseline, 'unconfigured extension must preserve provider-bound context');
  const manifestDir = join(project, '.yokodori');
  await mkdir(manifestDir);
  await writeFile(join(project, 'AGENTS.md'), 'secret declared text');
  await writeFile(join(project, 'ignored.txt'), 'second declared text');
  await writeFile(join(project, 'undeclared.txt'), 'not admitted');
  await writeFile(join(manifestDir, 'instruct.json'), JSON.stringify({ version: 1, context: [
    { path: 'AGENTS.md', kind: 'instructions', rank: 200 },
    { path: 'ignored.txt', kind: 'repository', rank: 100 },
  ] }));
  let certified;
  const injected = await capturedProviderContext({ cwd: project, agentDir: packageRoot, withPackage: true, expectedState: 'observed',
    onProof: proof => { certified = proof; },
    afterStart: async () => writeFile(join(project, 'AGENTS.md'), 'changed after session start') });
  const section = injected.find(message => message.role === 'system').payload.sections.yokodori_initial_context;
  assert.ok(section.includes('secret declared text'));
  assert.equal(section.includes('changed after session start'), false);
  assert.ok(section.indexOf('second declared text') < section.indexOf('secret declared text'), 'rank must govern ordering');
  assert.equal(section.includes('not admitted'), false);
  const body = section.slice('<yokodori_initial_context>\n'.length, -'\n</yokodori_initial_context>'.length);
  assert.equal(digest(body), certified.observedInjectedDigest);
  assert.equal(certified.observedInjectedDigest, certified.compiledDigest);

  let mismatch;
  await capturedProviderContext({ cwd: project, agentDir: packageRoot, withPackage: true,
    expectedState: 'certification_failure', tamper: true, onProof: proof => { mismatch = proof; } });
  assert.equal(mismatch.matched, false);
  assert.notEqual(mismatch.observedInjectedDigest, mismatch.compiledDigest);

  const entries = [
    { path: 'AGENTS.md', kind: 'instructions', rank: 200 },
    { path: 'ignored.txt', kind: 'repository', rank: 100 },
  ];
  const initial = await loadInstructions(project);
  await writeFile(join(manifestDir, 'instruct.json'), JSON.stringify({ version: 1, context: [...entries].reverse() }));
  assert.equal((await loadInstructions(project)).compiled.digest, initial.compiled.digest);
  for (const context of [
    [{ ...entries[0], rank: 100 }, entries[1]],
    [entries[0], { ...entries[1], path: './AGENTS.md' }],
    [{ ...entries[0], path: 'missing.txt' }],
    [{ ...entries[0], path: '/etc/passwd' }],
    [{ ...entries[0], path: '../escape.txt' }],
    [{ ...entries[0], path: 'C:\\Windows\\system.ini' }],
    [{ ...entries[0], path: '\\\\server\\share' }],
    [{ ...entries[0], kind: 'unsupported' }],
  ]) {
    await writeFile(join(manifestDir, 'instruct.json'), JSON.stringify({ version: 1, context }));
    await assert.rejects(loadInstructions(project));
    await capturedProviderContext({ cwd: project, agentDir: packageRoot, withPackage: true, expectedState: 'configuration_failure' });
  }
  await symlink(join(temporary, 'outside.txt'), join(project, 'escape.txt'));
  await writeFile(join(temporary, 'outside.txt'), 'outside');
  await writeFile(join(manifestDir, 'instruct.json'), JSON.stringify({ version: 1, context: [{ ...entries[0], path: 'escape.txt' }] }));
  await assert.rejects(loadInstructions(project));
  await writeFile(join(project, 'binary.txt'), Buffer.from([0xff, 0xfe]));
  await writeFile(join(manifestDir, 'instruct.json'), JSON.stringify({ version: 1, context: [{ ...entries[0], path: 'binary.txt' }] }));
  await assert.rejects(loadInstructions(project));
  await writeFile(join(manifestDir, 'instruct.json'), '{invalid json');
  await capturedProviderContext({ cwd: project, agentDir: packageRoot, withPackage: true, expectedState: 'configuration_failure' });

  const cliLoad = run(process.execPath, [piCli, '--help'], { cwd: project, env: agentEnvironment });
  assert.equal(cliLoad.includes('Failed to load extension'), false, 'Pi CLI must load the installed package without errors');
});
