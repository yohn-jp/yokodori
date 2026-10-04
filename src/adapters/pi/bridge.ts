import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { endpointFile } from '../../protocol/discovery.js';
import type { ObservationEventV1 } from '../../protocol/observation.js';

export function createBridge() {
  const streamId = randomUUID();
  let sequence = 0;
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();
  let disabled = false;
  const emit = (event: Omit<ObservationEventV1, 'version' | 'eventId' | 'streamId' | 'sequence' | 'observedAt' | 'source'>) => {
    if (disabled || pending >= 8) { disabled = true; return; }
    const envelope = { ...event, version: 1, eventId: randomUUID(), streamId, sequence: ++sequence,
      observedAt: new Date().toISOString(), source: { adapter: 'yokodori/pi', harness: 'pi' } } as ObservationEventV1;
    pending++;
    chain = chain.then(async () => {
      const descriptor: unknown = JSON.parse(await readFile(endpointFile(), 'utf8'));
      if (!descriptor || typeof descriptor !== 'object' || !('url' in descriptor) || typeof descriptor.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.url)) throw new Error('Invalid endpoint');
      const url = descriptor.url;
      const post = async (path: string, payload: unknown) => {
        const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(400) });
        if (!response.ok) throw new Error('Observation rejected');
      };
      if (envelope.sequence === 1) await post('/api/v1/streams', { streamId });
      await post(`/api/v1/streams/${streamId}/events`, envelope);
    }).catch(() => { disabled = true; }).finally(() => { pending--; });
  };
  return { emit };
}
