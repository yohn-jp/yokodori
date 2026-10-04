import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function observeGit(cwd: string) {
  const git = async (...args: string[]) => (await run('git', args, { cwd, timeout: 500, maxBuffer: 65536 })).stdout.trim();
  try {
    const root = await git('rev-parse', '--show-toplevel');
    const head = await git('rev-parse', 'HEAD').catch(() => undefined);
    const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => undefined);
    const dirty = await git('status', '--porcelain', '--untracked-files=normal').then(value => value ? 'dirty' as const : 'clean' as const).catch(() => 'unknown' as const);
    return { root, ...(head ? { head } : {}), ...(branch ? { branch } : {}), dirty };
  } catch { return undefined; }
}
