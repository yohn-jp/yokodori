import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { InitialContextInput } from '../../core/context.js';
import { snapshot } from '../../core/outbound.js';
import type { YokodoriRuntime } from '../../sdk/index.js';

export class PiAdapterError extends Error {
  constructor(readonly code: 'INCOMPATIBLE_PI', message: string) { super(message); this.name = 'PiAdapterError'; }
}
export class IncompleteTranscriptError extends Error {
  constructor(readonly requestSequence: number) {
    super(`Outbound transcript observation ${requestSequence} is incomplete`);
    this.name = 'IncompleteTranscriptError';
  }
}
export type InjectionMode = 'control' | 'append' | 'replace';
export interface ObservationFailure {
  readonly requestSequence: number;
  readonly error: unknown;
}
export interface PiAttachment {
  /** Supply this factory in DefaultResourceLoader extensionFactories. */
  readonly extension: ExtensionFactory;
  readonly status: () => { readonly certifiable: boolean | undefined; readonly failures: readonly ObservationFailure[] };
}

/** Await preparation before prompting: Pi catches extension-handler exceptions and cannot cancel a request. */
export async function createPiExtension(options: {
  readonly runtime: YokodoriRuntime;
  readonly initialContext?: () => InitialContextInput | Promise<InitialContextInput>;
  readonly injection?: InjectionMode;
  readonly certification?: 'default' | 'strict';
  readonly onObservationFailure?: (failure: ObservationFailure) => void;
}): Promise<PiAttachment> {
  const mode = options.injection ?? 'append';
  if (mode !== 'control' && mode !== 'append' && mode !== 'replace') throw new PiAdapterError('INCOMPATIBLE_PI', 'Invalid injection mode');
  if (mode !== 'control' && !options.initialContext) throw new PiAdapterError('INCOMPATIBLE_PI', 'Initial context is required');
  const compiled = mode === 'control' ? undefined : options.runtime.compile(await options.initialContext!());
  const failures: ObservationFailure[] = [];
  const extension: ExtensionFactory = pi => {
    if (typeof pi.on !== 'function') throw new PiAdapterError('INCOMPATIBLE_PI', 'Pi extension hooks unavailable');
    let sequence = 0;
    const started = pi.on('session_start', () => { sequence = 0; failures.length = 0; });
    const inject = compiled ? pi.on('before_agent_start', event => {
      if (mode === 'replace') return { systemPrompt: compiled.text };
      event.systemPromptOptions.sections['yokodori_initial_context'] = compiled.text;
    }) : undefined;
    const report = (failure: ObservationFailure) => {
      failures.push(failure);
      try { options.onObservationFailure?.(failure); } catch (diagnosticError) {
        failures.push({ requestSequence: failure.requestSequence, error: diagnosticError });
      }
    };
    const observe = pi.on('context_with_system', async event => {
      const current = ++sequence;
      try {
        const captured = snapshot(event.messages, current, mode === 'replace'
          ? { boundary: 'pi.context_with_system', providerEffective: false, knownPostBoundaryProjection: 'forced-system-prompt' }
          : { boundary: 'pi.context_with_system', providerEffective: false });
        if (!captured.complete) report({ requestSequence: current, error: new IncompleteTranscriptError(current) });
        await options.runtime.observe(captured);
      } catch (error) {
        report({ requestSequence: current, error });
      }
      // Undefined: no replacement, no in-place mutation.
    });
    if (typeof started !== 'function' || (compiled && typeof inject !== 'function') || typeof observe !== 'function')
      throw new PiAdapterError('INCOMPATIBLE_PI', 'Pi required extension hooks unavailable');
  };
  return { extension, status: () => ({ certifiable: options.certification === 'strict' ? failures.length === 0 : undefined, failures: [...failures] }) };
}
