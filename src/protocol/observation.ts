export type ObservationEventV1 = {
  readonly version: 1; readonly eventId: string; readonly streamId: string; readonly sequence: number;
  readonly observedAt: string; readonly source: { readonly adapter: string; readonly adapterVersion?: string; readonly harness?: string };
  readonly completeness?: 'complete' | 'partial' | 'unknown';
} & (
  | { readonly kind: 'stream.opened'; readonly payload: { readonly externalSessionId?: string; readonly parentStreamId?: string } }
  | { readonly kind: 'stream.closed'; readonly payload: Record<string, never> }
  | { readonly kind: 'context.compiled'; readonly payload: { readonly digest: string; readonly sourceCount: number; readonly rendererVersion: string } }
  | { readonly kind: 'context.injected'; readonly payload: { readonly state: 'injected'; readonly boundary: string } }
  | { readonly kind: 'context.observed'; readonly payload: { readonly requestSequence: number; readonly boundary: string; readonly complete: boolean; readonly observedDigest?: string; readonly certification: 'MATCH' | 'MISMATCH' } }
  | { readonly kind: 'git.observed'; readonly payload: { readonly root: string; readonly branch?: string; readonly head?: string; readonly dirty: 'dirty' | 'clean' | 'unknown' } }
);

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v);
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nat = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function parseObservationEvent(v: unknown): ObservationEventV1 {
  if (!record(v) || v.version !== 1) throw new Error('UNSUPPORTED_VERSION');
  if (!keys(v, ['version', 'eventId', 'streamId', 'sequence', 'observedAt', 'source', 'kind', 'payload'], ['completeness']) ||
    !str(v.eventId) || !str(v.streamId) || !nat(v.sequence) || (typeof v.sequence === 'number' && v.sequence < 1) ||
    typeof v.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(v.observedAt) || !Number.isFinite(Date.parse(v.observedAt)) ||
    !record(v.source) || !keys(v.source, ['adapter'], ['adapterVersion', 'harness']) || !str(v.source.adapter) ||
    (v.source.adapterVersion !== undefined && !str(v.source.adapterVersion)) || (v.source.harness !== undefined && !str(v.source.harness)) ||
    (v.completeness !== undefined && !['complete', 'partial', 'unknown'].includes(String(v.completeness))) || !record(v.payload)) throw new Error('INVALID_EVENT');
  const p = v.payload;
  let valid = false;
  switch (v.kind) {
    case 'stream.opened': valid = keys(p, [], ['externalSessionId', 'parentStreamId']) && (p.externalSessionId === undefined || str(p.externalSessionId)) && (p.parentStreamId === undefined || str(p.parentStreamId)); break;
    case 'stream.closed': valid = keys(p, []); break;
    case 'context.compiled': valid = keys(p, ['digest', 'sourceCount', 'rendererVersion']) && digest(p.digest) && nat(p.sourceCount) && str(p.rendererVersion); break;
    case 'context.injected': valid = keys(p, ['state', 'boundary']) && p.state === 'injected' && str(p.boundary); break;
    case 'context.observed': valid = keys(p, ['requestSequence', 'boundary', 'complete', 'certification'], ['observedDigest']) && nat(p.requestSequence) && (typeof p.requestSequence === 'number' && p.requestSequence > 0) && str(p.boundary) && typeof p.complete === 'boolean' && (p.observedDigest === undefined || digest(p.observedDigest)) && (p.certification === 'MATCH' || p.certification === 'MISMATCH'); break;
    case 'git.observed': valid = keys(p, ['root', 'dirty'], ['branch', 'head']) && str(p.root) && (p.branch === undefined || str(p.branch)) && (p.head === undefined || (typeof p.head === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(p.head))) && ['dirty', 'clean', 'unknown'].includes(String(p.dirty)); break;
  }
  if (!valid) throw new Error('INVALID_PAYLOAD');
  return v as ObservationEventV1;
}
