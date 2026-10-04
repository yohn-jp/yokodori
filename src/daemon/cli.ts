#!/usr/bin/env node
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDaemon } from './server.js';
import { endpointFile } from '../protocol/discovery.js';
if (process.argv.length !== 3 || process.argv[2] !== 'daemon') { console.error('Usage: yokodori daemon'); process.exitCode = 2; }
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
