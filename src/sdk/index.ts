import { compileInitialContext, ContextCompileError } from '../compiler/initial.js';
import type { InitialContextInput, OutboundContextSnapshot } from '../core/context.js';

export type { InitialContextInput, ContextSource, ContextSourceKind, CompiledInitialContext, CompiledSection, OutboundContextSnapshot, OutboundMessage, SemanticValue } from '../core/context.js';
export { ContextCompileError };

export interface YokodoriRuntime {
  readonly compile: (input: InitialContextInput) => ReturnType<typeof compileInitialContext>;
  readonly observe: (snapshot: OutboundContextSnapshot) => Promise<void>;
}
export function createYokodori(options: {
  readonly context?: { readonly profile?: string };
  readonly observer?: { readonly onOutboundContext: (snapshot: OutboundContextSnapshot) => void | Promise<void> };
} = {}): YokodoriRuntime {
  return {
    compile: input => compileInitialContext(input, options.context?.profile),
    observe: async snapshot => { await options.observer?.onOutboundContext(snapshot); },
  };
}
