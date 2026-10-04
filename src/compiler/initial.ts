import type { CompiledInitialContext, CompiledSection, ContextSource, ContextSourceKind, InitialContextInput } from '../core/context.js';
import { digest } from '../language/canonical.js';

export class ContextCompileError extends Error {
  constructor(readonly code: 'DUPLICATE_SOURCE' | 'INVALID_SOURCE', readonly sourceId: string) {
    super(`${code}: ${sourceId}`);
    this.name = 'ContextCompileError';
  }
}

const order = [
  ['runtime', 'Runtime protocol'], ['instructions', 'Repository instructions'],
  ['skills', 'Required skills'], ['architecture', 'Architecture and domain facts'],
  ['policy', 'Repository coding policy'], ['authority', 'Authority and constraints'],
  ['repository', 'Repository and workspace state'], ['task', 'Task'],
] as const;

/** Renderer v1 preserves source content; no lossy semantic compression. */
export function compileInitialContext(input: InitialContextInput, profile = 'balanced'): CompiledInitialContext {
  if (!profile || /[\r\n]/.test(profile)) throw new ContextCompileError('INVALID_SOURCE', 'profile');
  const sources: Record<ContextSourceKind, readonly ContextSource[]> = {
    runtime: input.runtime ?? [], instructions: input.instructions ?? [], skills: input.skills ?? [],
    architecture: input.architecture ?? [], policy: input.policy ?? [], authority: input.authority ?? [],
    repository: input.repository ? [input.repository] : [], task: [input.task],
  };
  const seen = new Set<string>();
  const sections: CompiledSection[] = [];
  for (const [kind, title] of order) {
    const sorted = [...sources[kind]].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const source of sorted) {
      if (typeof source.id !== 'string' || !source.id.trim() || typeof source.content !== 'string' || source.kind !== kind || /[\r\n]/.test(source.id)) {
        throw new ContextCompileError('INVALID_SOURCE', String(source.id));
      }
      if (seen.has(source.id)) throw new ContextCompileError('DUPLICATE_SOURCE', source.id);
      seen.add(source.id);
    }
    if (!sorted.length) continue;
    const content = `[${title}]\n${sorted.map(source => `Source: ${source.id}\n${Buffer.byteLength(source.content, 'utf8')}:\n${source.content}`).join('\n')}\n`;
    sections.push({ id: kind, kind, sourceIds: sorted.map(source => source.id), content, digest: digest(content) });
  }
  const text = `Yokodori initial context v1\nProfile: ${profile}\n\n${sections.map(section => section.content).join('\n')}`;
  return { version: 1, rendererVersion: '1', profile, sections, text, digest: digest(text) };
}
