import type { OutboundContextSnapshot, OutboundMessage, SemanticValue } from './context.js';
import { canonical, digest } from '../language/canonical.js';

/** Read-only projection. Unsupported values are marked incomplete, never given invented meaning. */
export function normalizeMessage(value: unknown): OutboundMessage {
  const omitted: string[] = [];
  const active = new WeakSet<object>();
  const project = (item: unknown, path: string): SemanticValue => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') { omitted.push(path); return null; }
    if (active.has(item)) { omitted.push(path); return null; }
    active.add(item);
    let result: SemanticValue;
    if (Array.isArray(item)) result = item.map((part, index) => project(part, `${path}[${index}]`));
    else if (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      const record: Record<string, SemanticValue> = {};
      for (const key of Object.keys(item).sort()) {
        // Only the message's own timestamp is observation metadata. Nested timestamps may be tool arguments.
        if (path === '$' && key === 'timestamp') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        record[key] = descriptor && 'value' in descriptor
          ? project(descriptor.value, `${path}.${key}`)
          : (omitted.push(`${path}.${key}`), null);
      }
      if (Object.getOwnPropertySymbols(item).length) omitted.push(`${path}.[symbol]`);
      result = record;
    } else { omitted.push(path); result = null; }
    active.delete(item);
    return result;
  };
  const payload = project(value, '$');
  const role = value !== null && typeof value === 'object' && 'role' in value && typeof value.role === 'string' ? value.role : 'unknown';
  return { role, payload, complete: omitted.length === 0, omittedFields: omitted.slice(0, 16), omittedFieldCount: omitted.length };
}

export function snapshot(messages: readonly unknown[], requestSequence: number, fidelity: OutboundContextSnapshot['fidelity']): OutboundContextSnapshot {
  const normalized = messages.map(normalizeMessage);
  const bytes = canonical(normalized.map(message => ({ role: message.role, payload: message.payload, complete: message.complete, omittedFields: [...message.omittedFields] })));
  const size = (role: string) => normalized.filter(message => message.role === role)
    .reduce((sum, message) => sum + Buffer.byteLength(canonical(message.payload)), 0);
  return {
    version: 1, requestSequence, messages: normalized, digest: digest(bytes), fidelity,
    complete: normalized.every(message => message.complete),
    stats: { messageCount: normalized.length, byteCount: Buffer.byteLength(bytes),
      systemBytes: size('system'), userBytes: size('user'), assistantBytes: size('assistant'),
      toolBytes: size('toolResult') + size('tool') },
  };
}
