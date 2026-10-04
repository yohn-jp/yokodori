import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const index = args.indexOf('--tarball');
if (index < 0 || !args[index + 1]) throw new Error('usage: smoke-test.mjs --tarball <path>');
const tarball = resolve(args[index + 1]);
const dir = await mkdtemp(join(tmpdir(), 'yokodori-smoke-'));
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: dir, encoding: 'utf8' });
  if (install.status !== 0) throw new Error(`npm install failed:\n${install.stdout}\n${install.stderr}`);
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('yokodori'); await import('yokodori/pi');"], { cwd: dir, encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`public import smoke failed:\n${probe.stdout}\n${probe.stderr}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
