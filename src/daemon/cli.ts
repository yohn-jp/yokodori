#!/usr/bin/env node
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDaemon } from './server.js';
import { endpointFile } from '../protocol/discovery.js';
const command = process.argv.length === 3 ? process.argv[2] : undefined;
if (command === '--help') {
  console.log('Usage: yokodori daemon\n       yokodori --help\n       yokodori --version\n\nRun a loopback-only observation daemon and read-only dashboard.');
} else if (command === '--version') {
  const metadata: unknown = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string') throw new Error('Invalid package version');
  console.log(metadata.version);
} else if (command !== 'daemon') { console.error('Usage: yokodori daemon (or --help, --version)'); process.exitCode = 2; }
else {
  const daemon = createDaemon();
  const url = await daemon.listen();
  const path = endpointFile();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify({ url }), { mode: 0o600 });
  console.log(`Yokodori dashboard: ${url}/`);
  const stop = async () => {
    try { if ((await readFile(path, 'utf8')) === JSON.stringify({ url })) await unlink(path); } catch { /* descriptor already removed */ }
    await daemon.close();
  };
  process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
  process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
}
