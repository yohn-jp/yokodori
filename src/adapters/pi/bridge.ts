import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { endpointFile } from '../../protocol/discovery.js';
import type { ObservationEventV1 } from '../../protocol/observation.js';

const MAX_PENDING = 8;

export function createBridge() {
  const streamId = randomUUID();
  let sequence = 0;
  const queue: ObservationEventV1[] = [];
  let draining = false;
  let dropped = 0;
  let lastFailure: string | undefined;

  const postEnvelope = async (envelope: ObservationEventV1) => {
    const descriptor: unknown = JSON.parse(await readFile(endpointFile(), 'utf8'));
    if (!descriptor || typeof descriptor !== 'object' || !('url' in descriptor) || typeof descriptor.url !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.url)) throw new Error('invalid_endpoint');
    const url = descriptor.url;
    const post = async (path: string, payload: unknown) => {
      const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(400) });
      if (!response.ok) throw new Error(`http_${response.status}`);
    };
    if (envelope.sequence === 1) await post('/api/v1/streams', { streamId });
    await post(`/api/v1/streams/${streamId}/events`, envelope);
  };

  const drain = () => {
    if (draining || queue.length === 0) return;
    draining = true;
    void (async () => {
      while (queue.length > 0) {
        try {
          const envelope = queue[0];
          if (!envelope) break;
          await postEnvelope(envelope);
          queue.shift();
          lastFailure = undefined;
        } catch (error) {
          lastFailure = error instanceof Error ? error.message : 'observation_failed';
          break;
        }
      }
    })().finally(() => { draining = false; });
  };

  const emit = (event: Omit<ObservationEventV1, 'version' | 'eventId' | 'streamId' | 'sequence' | 'observedAt' | 'source'>) => {
    if (queue.length >= MAX_PENDING) {
      dropped++;
      drain();
      return;
    }
    queue.push({ ...event, version: 1, eventId: randomUUID(), streamId, sequence: ++sequence,
      observedAt: new Date().toISOString(), source: { adapter: 'yokodori/pi', harness: 'pi' } } as ObservationEventV1);
    drain();
  };

  const status = () => ({
    state: lastFailure || dropped > 0 ? 'degraded' as const : 'healthy' as const,
    pending: queue.length,
    dropped,
    ...(lastFailure ? { lastFailure } : {}),
  });

  return { emit, status };
}
