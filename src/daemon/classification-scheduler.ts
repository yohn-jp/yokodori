import { MESSAGE_PROFILE, type Classification } from '../protocol/classification.js';
import { classify } from './classification-client.js';

export const CLASSIFICATION_CONCURRENCY = 2;
export const CLASSIFICATION_QUEUE_LIMIT = 16;
type Job = { eventId: string; sequence: number; observedAt: string; role: string; text: string; retained: () => boolean; update: (value: Classification) => void };
export function createClassificationScheduler() {
  const queue: Job[] = [];
  const controllers = new Set<AbortController>();
  const running = new Set<Promise<void>>();
  let closed = false;
  const base = (job: Job): Classification => ({ classificationId: `message:${job.eventId}`, sourceEventId: job.eventId,
    sourceSequence: job.sequence, profile: { id: MESSAGE_PROFILE.id, version: MESSAGE_PROFILE.version },
    status: 'pending', observedAt: job.observedAt, axes: MESSAGE_PROFILE.axes.map(axis => ({ id: axis.id })) });
  function pump() {
    while (!closed && running.size < CLASSIFICATION_CONCURRENCY && queue.length) {
      const job = queue.shift()!;
      if (!job.retained()) continue;
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 800);
      const task = (async () => {
        try {
          const result = await classify(job.role, job.text, controller.signal);
          if (!closed && job.retained()) job.update({ ...base(job), ...result, status: 'complete', completedAt: new Date().toISOString() });
        } catch (error) {
          if (closed || !job.retained()) return;
          const code = error instanceof Error ? error.message : '';
          const failure = code === 'NOT_READY' || code === 'UNAVAILABLE' ? code :
            controller.signal.aborted ? 'TIMEOUT' : code === 'INVALID_RESPONSE' || code === 'HTTP_ERROR' ? code : 'UNAVAILABLE';
          job.update({ ...base(job), status: failure === 'UNAVAILABLE' || failure === 'NOT_READY' ? 'unavailable' : 'failed',
            completedAt: new Date().toISOString(), failure });
        } finally { clearTimeout(timer); controllers.delete(controller); }
      })();
      running.add(task);
      void task.finally(() => { running.delete(task); pump(); });
    }
  }
  return {
    schedule(job: Job) {
      if (closed || !job.retained()) return;
      job.update(base(job));
      if (queue.length >= CLASSIFICATION_QUEUE_LIMIT && running.size >= CLASSIFICATION_CONCURRENCY) {
        job.update({ ...base(job), status: 'unavailable', completedAt: new Date().toISOString(), failure: 'QUEUE_FULL' });
        return;
      }
      queue.push(job); pump();
    },
    close: async () => { closed = true; queue.length = 0; for (const controller of controllers) controller.abort(); await Promise.all([...running]); },
  };
}
