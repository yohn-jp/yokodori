import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const artifact = process.env.RELEASE_ARTIFACT_PATH;
const tag = process.env.RELEASE_TAG;
if (!artifact) throw new Error('RELEASE_ARTIFACT_PATH is required');
if (!tag) throw new Error('RELEASE_TAG is required');

const listing = spawnSync('tar', ['-tzf', artifact], { encoding: 'utf8' });
if (listing.status !== 0) throw new Error(`cannot inspect release artifact: ${listing.stderr}`);
const entries = new Set(listing.stdout.trim().split('\n'));
for (const required of [
  'package/package.json',
  'package/dist/sdk/index.js',
  'package/dist/adapters/pi/index.js',
  'package/dist/adapters/pi/package-extension.js',
]) {
  if (!entries.has(required)) throw new Error(`release artifact missing ${required}`);
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (tag !== `v${packageJson.version}`) throw new Error(`release tag ${tag} does not match package version ${packageJson.version}`);
if (packageJson.pi?.extensions?.[0] !== './dist/adapters/pi/package-extension.js') {
  throw new Error('Pi extension manifest is not the certified package entrypoint');
}
