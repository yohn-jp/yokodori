# Epic Architecture: Pi Context Boundary

Status: accepted implementation architecture  
Date: 2026-10-04  
Scope: first executable Yokodori vertical slice

## 1. Objective

The first Yokodori implementation establishes deterministic ownership of initial model context and observation of the exact Pi transcript immediately before provider dispatch.

This Epic is intentionally narrow.

It must prove two properties:

1. the same admitted semantic inputs compile to the same initial context bytes and digest;
2. every Pi model request can be observed at the final extension boundary before provider-specific conversion without modifying Pi Core.

No semantic compression, metacognitive inference, Hachidori/Clef integration, or fork orchestration is required for this Epic.

The implementation creates the boundary on which those later capabilities depend.

## 2. Architectural outcome

The first executable path is:

```text
caller / Tsukai / test harness
        |
        v
Yokodori SDK
        |
        +--> InitialContextCompiler
        |        |
        |        v
        |   CompiledInitialContext
        |        |
        |        v
        +--> PiAdapter / inline Pi extension
                 |
                 +--> before_agent_start
                 |       injects deterministic initial context
                 |
                 +--> context_with_system
                         captures the full outbound transcript
                         after Pi restores prompt/tool state
                         and before provider-specific conversion
                 |
                 v
                Pi
                 |
                 v
            model/provider
```

The initial adapter runs in-process with Pi.

Yokodori does not own the Pi process, Pi session persistence, model credentials, provider transport, or AgentRun lifecycle.

## 3. Product and implementation boundaries

### 3.1 Yokodori owns

For this Epic Yokodori owns:

- the public TypeScript SDK contract;
- the deterministic Initial Context Compiler;
- initial context section identity and ordering;
- canonical context rendering;
- context digests;
- the Pi adapter;
- passive capture of outbound model context;
- normalized outbound-context snapshots;
- deterministic test fixtures;
- architecture/import-boundary enforcement.

### 3.2 Yokodori does not own

This Epic does not give Yokodori ownership of:

- Pi sessions;
- Pi transcript persistence;
- task decomposition;
- Tsukai AgentRun lifecycle;
- workspace or filesystem authority;
- physical execution;
- GitHub governance;
- model/provider execution;
- semantic inference;
- model-output evaluation;
- context compression;
- evidence paging;
- forks.

## 4. Pi integration authority

Pi is an adapter dependency, never a Yokodori Core dependency.

The current Pi extension contract provides two relevant hooks.

### 4.1 `before_agent_start`

Use this hook to project the Yokodori compiled initial context into the Pi request path.

The implementation must keep the injection strategy explicit. Initial experiments support at least:

- `append`: preserve Pi's base system prompt and append the Yokodori initial section;
- `replace`: use the Yokodori compiled prompt as the effective request system prompt where Pi's extension contract permits this.

The default production mode for the first Epic is `append` until controlled experiments prove that replacement preserves required Pi runtime semantics.

The injection mode is policy, not part of the semantic input digest.

### 4.2 `context_with_system`

Use this hook as the outbound transcript boundary.

At this point Pi has already:

- reconstructed the active conversation;
- applied ordinary context handlers;
- restored the current system prompt;
- restored tool declaration state.

The event therefore exposes the complete transcript intended for the next model request before provider-specific conversion.

The first Epic uses this hook passively:

```text
context_with_system
      |
      +--> snapshot(raw outbound transcript)
      |
      +--> return undefined
```

No outbound transcript mutation is enabled in the first certification path.

A later Epic may return a transformed transcript from this same boundary.

## 5. SDK-first package architecture

Yokodori is a TypeScript library/SDK product.

The CLI, if one is ever added, is a diagnostic projection and not a product authority boundary.

Initial package exports are deliberately minimal:

```json
{
  "exports": {
    ".": "./dist/sdk/index.js",
    "./pi": "./dist/adapters/pi/index.js"
  }
}
```

No internal `core`, `compiler`, `language`, or `ports` module is a public package subpath.

The public API may grow only through an explicit contract change.

## 6. Repository structure

The first implementation uses the following structure.

```text
src/
├─ vocabulary/
│  └─ ...
│
├─ language/
│  ├─ canonical.ts
│  ├─ loss.ts
│  └─ profile.ts
│
├─ core/
│  └─ context/
│     ├─ source.ts
│     ├─ section.ts
│     ├─ compiled-context.ts
│     └─ outbound-context.ts
│
├─ compiler/
│  └─ initial/
│     ├─ compiler.ts
│     ├─ sources.ts
│     ├─ ordering.ts
│     └─ digest.ts
│
├─ ports/
│  └─ harness.ts
│
├─ application/
│  ├─ create-runtime.ts
│  └─ observe-context.ts
│
├─ adapters/
│  └─ pi/
│     ├─ index.ts
│     ├─ extension.ts
│     ├─ context-reader.ts
│     └─ context-writer.ts
│
└─ sdk/
   └─ index.ts

test/
├─ compiler/
├─ adapters/
│  └─ pi/
└─ integration/

fixtures/
└─ initial-context/
```

Directories that have no implementation in this Epic must not be created merely as placeholders.

In particular, do not create empty Hachidori, Tsukai, probe, fork, or metacognition modules.

## 7. Dependency direction

Dependencies point inward.

Conceptually:

```text
vocabulary
    ^
language
    ^
 core <------ ports
    ^           ^
    |           | implemented by
compiler     adapters/pi
    ^           |
    +-----+-----+
          ^
     application
          ^
         sdk
```

The exact TypeScript file graph may vary, but these invariants do not.

### 7.1 Forbidden dependencies

The following are forbidden:

- `src/core/**` importing Pi packages;
- `src/compiler/**` importing Pi packages;
- `src/language/**` importing Pi packages;
- `src/vocabulary/**` importing Pi packages;
- Core importing application, adapter, SDK, or external-product implementation modules;
- compiler behavior depending on filesystem traversal order, object property enumeration accident, wall-clock time, randomness, locale, or process environment unless explicitly admitted as an input.

Pi-specific imports belong under `src/adapters/pi/**`.

These rules must be machine-enforced in CI.

## 8. Initial context input contract

The caller supplies semantic sources, not a single preassembled prompt.

Initial shape:

```ts
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

export interface ContextSource {
  readonly id: string;
  readonly kind: ContextSourceKind;
  readonly content: string;
  readonly digest?: string;
}
```

The caller does not control final section order by array position.

Each source ID must be stable within its authority domain.

Duplicate source IDs are rejected unless an explicit future merge contract defines otherwise.

## 9. Canonical section order

The compiler owns deterministic ordering.

The first ordering contract is:

```text
01 runtime protocol
02 Yokodori language / model-facing protocol
03 repository instructions
04 required skills
05 architecture and domain facts
06 repository coding policy
07 authority and constraints
08 repository/workspace state
09 task
```

The exact human-readable headings are part of the renderer version.

Within a section class, sources are sorted deterministically by stable source identity unless that source type defines an explicit semantic order.

Changing canonical ordering is a versioned output-contract change.

## 10. Compiled context contract

The compiler returns structured output plus rendered bytes.

```ts
export interface CompiledInitialContext {
  readonly version: 1;
  readonly rendererVersion: string;
  readonly profile: string;
  readonly sections: readonly CompiledSection[];
  readonly text: string;
  readonly digest: string;
}

export interface CompiledSection {
  readonly id: string;
  readonly kind: ContextSectionKind;
  readonly sourceIds: readonly string[];
  readonly content: string;
  readonly digest: string;
}
```

The digest is computed from the canonical rendered bytes using one documented hash algorithm.

A section digest is computed from its canonical section bytes.

A context digest is computed from the final complete compiled bytes.

Digests identify content, not authority or authorization.

## 11. Determinism contract

For admitted input `I`, compiler version `V`, and profile `P`:

```text
compile(I, V, P) -> B
compile(I, V, P) -> B
```

must produce identical bytes `B`.

The following must not affect output unless represented explicitly in input:

- input collection iteration order;
- host path spelling where path is not semantic content;
- process ID;
- timestamp;
- random UUID;
- hostname;
- locale;
- timezone;
- temporary directory;
- object insertion order;
- filesystem directory enumeration order.

Volatile facts such as HEAD, branch, workspace identity, or task revision are valid inputs only when the caller supplies them explicitly as semantic sources.

## 12. Canonical language policy for this Epic

Yokodori owns its model-facing language.

This Epic does not require complete controlled-language conversion.

The initial compiler may use a stable canonical section format and vocabulary while preserving source content when semantic reduction has not been proven safe.

The long-term target is adaptive, loss-aware canonicalization, not formal ASD-STE100 compliance.

A future balanced profile is expected to canonicalize roughly 70-80% of eligible machine-facing expression while retaining natural-language escape paths where compression would materially weaken meaning.

That ratio is an empirical policy parameter, not an invariant of this Epic.

## 13. Outbound context snapshot

Each Pi model request produces one passive observation.

Initial contract:

```ts
export interface OutboundContextSnapshot {
  readonly version: 1;
  readonly requestSequence: number;
  readonly capturedAt?: string;

  readonly messages: readonly OutboundMessage[];
  readonly digest: string;

  readonly stats: {
    readonly messageCount: number;
    readonly byteCount: number;
    readonly systemBytes: number;
    readonly userBytes: number;
    readonly assistantBytes: number;
    readonly toolBytes: number;
    readonly estimatedTokens?: number;
  };
}
```

`capturedAt` is observation metadata and must not participate in the context digest.

The snapshot digest is derived from canonical serialization of the transcript payload, not from timestamp or sequence number.

The snapshot is a Yokodori observation of Pi's outbound transcript. It is not a replacement authority for Pi session persistence.

## 14. Transcript normalization

The observer must preserve semantic distinctions needed for later context work.

At minimum preserve:

- message role;
- system sections/messages;
- user content;
- assistant text/thinking where Pi exposes it in the outbound transcript;
- tool calls;
- tool results;
- image/content-block identity where representable;
- custom message type needed to reproduce semantic behavior.

Normalization must be lossless for the fields retained in the first snapshot schema.

If Pi exposes a value that cannot be represented safely, the observer must report an explicit unsupported/omitted field rather than silently collapsing it.

## 15. Raw evidence and privacy boundary

Passive capture can include sensitive repository or user data because it observes model-visible context.

Therefore:

- no snapshot is logged by default to stdout/stderr;
- no snapshot is transmitted externally by Yokodori;
- persistence is opt-in through an injected observer/store;
- observer failures do not mutate the Pi transcript;
- diagnostics must not dump the complete context unless explicitly requested by the host;
- digests and bounded statistics are preferred for routine diagnostics.

The first SDK may support an in-memory observer for tests and experiments without defining a durable storage product.

## 16. Public SDK contract

The first public surface should remain small.

Conceptual API:

```ts
import {
  createYokodori,
  type InitialContextInput,
  type OutboundContextSnapshot,
} from "yokodori";

const runtime = createYokodori({
  context: {
    profile: "balanced",
  },
  observer: {
    onOutboundContext(snapshot) {
      // host-owned persistence or analysis
    },
  },
});
```

Pi integration is separate:

```ts
import { createPiExtension } from "yokodori/pi";

const extension = createPiExtension({
  runtime,
  initialContext: async () => input,
  injection: "append",
});
```

The exact names may change during implementation before first release, but the ownership boundary does not.

## 17. Runtime lifecycle

The Yokodori runtime must not create hidden global mutable state.

A runtime instance owns:

- compiler configuration;
- renderer/profile selection;
- observer callbacks;
- request sequence state associated with adapter attachment where needed.

Pi session lifecycle remains Pi/Tsukai-owned.

Disposing a Pi session must not require a global Yokodori daemon.

A future resident Probe may use another process, but that is outside this Epic.

## 18. Failure semantics

### 18.1 Compiler failure

If initial context cannot be compiled deterministically:

- fail before the affected model request;
- return a typed Yokodori error;
- do not silently fall back to an ad-hoc prompt.

### 18.2 Observer failure

The supported Pi `context_with_system` runner catches extension-handler errors and continues the request. Its return contract permits transcript replacement but does not grant cancellation authority.

Therefore Yokodori must not claim fail-closed provider execution through this hook.

In passive mode, an outbound observer failure:

- must not rewrite the transcript;
- must be surfaced through Yokodori observation/certification state;
- must allow Pi to continue according to Pi's own execution semantics;
- defaults to fail-open for model execution and fail-visible for diagnostics.

Strict certification means **fail the certification result**, not **cancel the provider request**. A run/request with an observer failure is not certifiable as completely observed even though Pi may continue executing it.

If future Pi APIs expose an authoritative pre-provider cancellation contract, fail-closed execution may be designed as a separate capability. Yokodori must not emulate cancellation by transcript mutation, synthetic errors, provider monkey-patching, or Pi Core modification.

### 18.3 Pi adapter incompatibility

If required Pi hooks are unavailable or incompatible:

- adapter initialization fails explicitly;
- no lower-fidelity hidden interception path is substituted.

### 18.4 Unsupported transcript content

Unknown content is preserved opaquely when safe.

If safe preservation is impossible, the snapshot records explicit incompleteness.

It must not fabricate normalized meaning.

## 19. Shadow-mode invariant

The first certified path is observational.

For the same Pi session input, enabling passive Yokodori capture must not change the request transcript delivered by Pi.

The integration test should prove:

```text
Pi without Yokodori passive observer
          ==
Pi with Yokodori passive observer
```

at the provider-facing normalized transcript boundary, except for intentionally injected initial context in experiments that enable injection.

This separates the two experiments:

- deterministic initial-context intervention;
- passive outbound-context observation.

## 20. Initial experimental modes

The adapter supports three experiment configurations.

### Control

```text
Pi default initial context
No Yokodori injection
Optional passive outbound capture
```

### Append

```text
Pi default system context
+ Yokodori deterministic initial context
+ passive outbound capture
```

### Replace

```text
Yokodori-controlled initial system context
+ passive outbound capture
```

Replace mode is experimental until required Pi semantics are proven preserved.

## 21. Behavioral consistency experiment

The first product question is not whether generated prose is identical.

It is whether deterministic initial context reduces unnecessary behavioral variance.

Hold constant as much as practical:

- repository revision;
- task;
- model/provider;
- thinking level;
- tools;
- workspace state;
- Yokodori compiler version;
- initial context inputs.

Measure:

- first tool selected;
- first files inspected;
- inspection order;
- turns before first edit;
- modified file set;
- test commands selected;
- total turns;
- transmitted tokens;
- final verification result;
- task success;
- outbound-context growth by turn.

The baseline experiment should compare repeated Control and Append runs.

Replace mode follows after Append is understood.

## 22. Certification tests

The Epic is not complete without tests proving the contracts.

### Compiler

- equivalent source order produces identical bytes;
- repeated compile produces identical bytes and digest;
- changed semantic input changes the relevant section/context digest;
- volatile metadata excluded from digest does not affect digest;
- duplicate identities fail deterministically;
- renderer output is covered by golden fixtures.

### Dependency boundaries

- forbidden Pi imports outside `adapters/pi` fail CI;
- internal package paths are not exported.

### Pi adapter

- inline extension loads through supported Pi SDK/resource-loader mechanisms;
- `before_agent_start` receives and injects compiled context;
- `context_with_system` capture includes current system state;
- passive observation returns no transcript mutation;
- request sequence is monotonic per attached adapter/session boundary;
- observer failure semantics are tested.

### Integration

Using a deterministic/fake provider where practical:

- provider-visible transcript with passive capture equals provider-visible transcript without passive capture;
- Append mode contains the exact compiled context bytes;
- the snapshot digest corresponds to the observed transcript;
- multiple model calls each produce exactly one outbound snapshot.

A live provider test is useful for dogfood but must not be the only correctness proof.

## 23. Epic implementation boundary

This Epic is complete when the following pipeline works end-to-end:

```text
InitialContextInput
       |
       v
deterministic compiler
       |
       v
CompiledInitialContext + digest
       |
       v
Pi inline adapter
       |
       +--> before_agent_start injection
       |
       +--> context_with_system passive tap
                       |
                       v
              OutboundContextSnapshot
                       |
                       v
                  observer
```

and all deterministic, passive-equivalence, import-boundary, and integration tests pass.

## 24. Explicitly deferred work

Do not expand this Epic to include:

- 70-80% canonicalization engine;
- semantic-loss scoring;
- Hachidori/Clef;
- semantic Probe;
- cognitive-state model;
- semantic trajectory;
- metacognitive policy;
- context compression;
- raw-evidence paging;
- context rehydration;
- outbound transcript replacement;
- human rendering fork;
- speculative reasoning forks;
- Tsukai production integration;
- Mottainai production integration.

Those capabilities depend on evidence collected through this Epic.

## 25. Follow-on architecture

Once the boundary is certified, the next sequence is expected to be:

```text
Epic 1: deterministic initial context + passive outbound tap
    |
    v
Epic 2: dataset / context-growth analysis + loss-aware projection contract
    |
    v
Epic 3: outbound context interception in shadow/A-B modes
    |
    v
Epic 4: semantic Probe + Hachidori/Clef
    |
    v
Epic 5: canonical cognitive/metacognitive state
    |
    v
Epic 6: fork topology + human-output projection
```

The sequence is evidence-driven. Later Epic boundaries may be adjusted from measured results without changing the authority model.

## 26. Architecture invariants

The first implementation must preserve these invariants:

1. Yokodori is SDK-first, not CLI-first.
2. Pi is an adapter.
3. Core never imports Pi.
4. semantic input is structured; callers do not provide one giant authoritative prompt.
5. canonical ordering belongs to Yokodori.
6. equal admitted input produces equal compiled bytes.
7. passive outbound capture cannot change the model request.
8. raw outbound context is sensitive evidence and is not persisted or logged by default.
9. provider wire format is not Yokodori Core's contract.
10. the first Epic captures evidence before attempting semantic compression.
11. controlled-language coverage is empirical and loss-aware, not formal STE100 compliance.
12. later human-readable output should be a derived projection, not permanent main-context narration.
13. future human rendering may execute in a fork, but that topology is not part of this Epic.
14. no external authority is duplicated merely to make context construction convenient.
15. the directory/import graph is an executable architecture constraint.
