import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { compileRankedFiles } from '../../compiler/initial.js';
import type { CompiledInitialContext, ContextSourceKind } from '../../core/context.js';

export const instructionFile = '.yokodori/instruct.json';
const kinds = new Set<ContextSourceKind>(['task', 'repository', 'instructions', 'architecture', 'policy', 'skills', 'authority', 'runtime']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const inside = (root: string, file: string) => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

export async function loadInstructions(cwd: string): Promise<{ compiled: CompiledInitialContext; sourceCount: number } | undefined> {
  const root = await realpath(cwd);
  const manifest = resolve(root, instructionFile);
  let bytes: Buffer;
  try {
    const actual = await realpath(manifest);
    if (!inside(root, actual)) throw new Error('Manifest escapes repository root');
    bytes = await readFile(manifest);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { await lstat(manifest); } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      }
    }
    throw new Error('Cannot read Yokodori manifest', { cause: error });
  }
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid manifest');
    const data = parsed as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.context) || !data.context.length) throw new Error('Invalid manifest version or context');
    const paths = new Set<string>();
    const ranks = new Set<number>();
    const sources = [];
    for (const entry of data.context) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid source');
      const { path, kind, rank } = entry as Record<string, unknown>;
      if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || isAbsolute(path)
        || /^[a-zA-Z]:/.test(path) || path.startsWith('//')) throw new Error('Invalid source path');
      const normalized = posix.normalize(path);
      if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || !inside(root, resolve(root, normalized))) throw new Error('Source escapes repository root');
      if (paths.has(normalized)) throw new Error('Duplicate source path');
      paths.add(normalized);
      if (typeof kind !== 'string' || !kinds.has(kind as ContextSourceKind)) throw new Error('Unsupported source kind');
      if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 0 || ranks.has(rank)) throw new Error('Invalid or duplicate rank');
      ranks.add(rank);
      const file = resolve(root, normalized);
      if (!inside(root, await realpath(file))) throw new Error('Source symlink escapes repository root');
      const content = decoder.decode(await readFile(file));
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw new Error('Binary source');
      sources.push({ id: `file:${normalized}`, kind: kind as ContextSourceKind, rank, content });
    }
    return { compiled: compileRankedFiles(sources), sourceCount: sources.length };
  } catch (error) {
    throw new Error('Invalid Yokodori instruction manifest or declared source', { cause: error });
  }
}
