import { createHash } from 'node:crypto';
import type { SemanticValue } from '../core/context.js';

/** UTF-8 SHA-256, lowercase hex. */
export function digest(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

export function canonical(value: SemanticValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, SemanticValue>>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key]!)}`).join(',')}}`;
}
