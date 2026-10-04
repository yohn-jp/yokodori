export type ContextSourceKind = 'task' | 'repository' | 'instructions' | 'architecture' | 'policy' | 'skills' | 'authority' | 'runtime';
export interface ContextSource {
  readonly id: string;
  readonly kind: ContextSourceKind;
  readonly content: string;
  readonly digest?: string;
}
export interface InitialContextInput {
  readonly task: ContextSource;
  readonly repository?: ContextSource;
  readonly instructions?: readonly ContextSource[];
  readonly architecture?: readonly ContextSource[];
  readonly policy?: readonly ContextSource[];
  readonly skills?: readonly ContextSource[];
  readonly authority?: readonly ContextSource[];
  readonly runtime?: readonly ContextSource[];
}
export interface CompiledSection {
  readonly id: string;
  readonly kind: ContextSourceKind;
  readonly sourceIds: readonly string[];
  readonly content: string;
  readonly digest: string;
}
export interface CompiledInitialContext {
  readonly version: 1;
  readonly rendererVersion: string;
  readonly profile: string;
  readonly sections: readonly CompiledSection[];
  readonly text: string;
  readonly digest: string;
}
/** JSON-compatible, recursively key-sorted semantic data. */
export type SemanticValue = null | boolean | number | string | readonly SemanticValue[] | { readonly [key: string]: SemanticValue };
export interface OutboundMessage {
  readonly role: string;
  readonly payload: SemanticValue;
  readonly complete: boolean;
  readonly omittedFields: readonly string[];
}
export interface OutboundContextSnapshot {
  readonly version: 1;
  readonly requestSequence: number;
  readonly messages: readonly OutboundMessage[];
  readonly digest: string;
  readonly complete: boolean;
  readonly fidelity: {
    readonly boundary: string;
    readonly providerEffective: boolean;
    readonly knownPostBoundaryProjection?: string;
  };
  readonly stats: {
    readonly messageCount: number;
    readonly byteCount: number;
    readonly systemBytes: number;
    readonly userBytes: number;
    readonly assistantBytes: number;
    readonly toolBytes: number;
  };
}
