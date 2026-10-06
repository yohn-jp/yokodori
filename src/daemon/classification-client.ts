import { MESSAGE_PROFILE, type Classification } from '../protocol/classification.js';

export const CLASSIFICATION_TIMEOUT_MS = 800;
export function messageState(role: string, text: string): string {
  return JSON.stringify({ role, text });
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const unit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

export async function classify(role: string, text: string, signal: AbortSignal): Promise<Pick<Classification, 'axes' | 'classifier' | 'timing'>> {
  const endpoint = process.env.HACHIDORI_ENDPOINT ?? 'http://127.0.0.1:7843';
  const url = new URL('/v1/decide', endpoint);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1') throw new Error('UNAVAILABLE');
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ schema: 'hachidori.v1', state: messageState(role, text),
      questions: MESSAGE_PROFILE.axes.map(axis => ({ id: axis.id, type: 'choice',
        instructions: `Classify the message ${axis.id}.`, choices: axis.choices })) }),
  });
  if (response.status === 503) throw new Error('NOT_READY');
  if (!response.ok) throw new Error('HTTP_ERROR');
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('INVALID_RESPONSE'); }
  if (!record(data) || data.schema !== 'hachidori.v1' || !Array.isArray(data.results) || data.results.length !== MESSAGE_PROFILE.axes.length) throw new Error('INVALID_RESPONSE');
  const results = data.results as unknown[];
  const axes = MESSAGE_PROFILE.axes.map((axis, index) => {
    const result: unknown = results[index];
    if (!record(result) || result.id !== axis.id || result.type !== 'choice' || !axis.choices.some(choice => choice === result.choice) || !unit(result.confidence) || !record(result.probabilities)) throw new Error('INVALID_RESPONSE');
    const probabilities = result.probabilities;
    if (Object.keys(probabilities).length !== axis.choices.length || axis.choices.some(choice => !unit(probabilities[choice]))) throw new Error('INVALID_RESPONSE');
    const sum = axis.choices.reduce((total, choice) => total + (probabilities[choice] as number), 0);
    const top = Math.max(...axis.choices.map(choice => probabilities[choice] as number));
    if (Math.abs(sum - 1) > 1e-3 || Math.abs((probabilities[result.choice as string] as number) - result.confidence) > 1e-6 || (probabilities[result.choice as string] as number) < top - 1e-9) throw new Error('INVALID_RESPONSE');
    return { id: axis.id, choice: result.choice as string, confidence: result.confidence, probabilities: Object.fromEntries(axis.choices.map(choice => [choice, probabilities[choice] as number])) };
  });
  const classifier: Classification['classifier'] = { schema: 'hachidori.v1' };
  if (data.served !== undefined) {
    if (!record(data.served) || typeof data.served.model !== 'string' || typeof data.served.provider !== 'string') throw new Error('INVALID_RESPONSE');
    classifier.model = data.served.model; classifier.provider = data.served.provider;
  }
  let timing: Classification['timing'];
  if (data.timing !== undefined) {
    if (!record(data.timing) || !finite(data.timing.inference_ms) || data.timing.inference_ms < 0 || !finite(data.timing.total_ms) || data.timing.total_ms < 0) throw new Error('INVALID_RESPONSE');
    timing = { inferenceMs: data.timing.inference_ms, totalMs: data.timing.total_ms };
  }
  return { axes, classifier, ...(timing ? { timing } : {}) };
}
