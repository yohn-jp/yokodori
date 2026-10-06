// Canonical Yokodori message classification profile. Hachidori remains the inference authority.
export const MESSAGE_PROFILE = {
  id: 'message', version: 1,
  axes: [
    { id: 'activity', version: 1, choices: ['implement', 'test', 'debug', 'research', 'review', 'verify', 'release', 'other'] },
    { id: 'intent', version: 1, choices: ['instruction', 'question', 'correction', 'approval', 'rejection', 'proposal', 'explanation', 'other'] },
    { id: 'domain', version: 1, choices: ['ui', 'architecture', 'git', 'testing', 'release', 'runtime', 'other'] },
    { id: 'execution_state', version: 1, choices: ['exploration', 'decision', 'implementation', 'verification', 'blocked', 'other'] },
  ],
} as const;

export type Classification = {
  classificationId: string; sourceEventId: string; sourceSequence: number;
  profile: { id: typeof MESSAGE_PROFILE.id; version: typeof MESSAGE_PROFILE.version };
  status: 'pending' | 'complete' | 'failed' | 'unavailable';
  observedAt: string; completedAt?: string;
  axes: { id: string; choice?: string; confidence?: number; probabilities?: Record<string, number> }[];
  classifier?: { schema: 'hachidori.v1'; model?: string; provider?: string };
  timing?: { inferenceMs: number; totalMs: number };
  failure?: 'QUEUE_FULL' | 'UNAVAILABLE' | 'NOT_READY' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'HTTP_ERROR';
};
