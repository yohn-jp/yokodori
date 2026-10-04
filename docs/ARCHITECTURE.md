# Yokodori Architecture Canon

Status: accepted initial architecture  
Date: 2026-10-04

## 1. Product thesis

Yokodori owns the context that a model sees.

It sits beside the AgentRun lifecycle rather than inside model reasoning itself. Its job is to observe cognition, normalize it into durable semantic and metacognitive state, construct the effective context for each model request, and decide when reasoning should remain in the main context, move into a fork, or be delegated elsewhere.

Yokodori exists because raw session history is not a suitable long-lived cognitive state.

A coding agent naturally produces large amounts of transient material:

- narration about intended actions;
- repeated inspection;
- tool output;
- stack traces;
- failed hypotheses;
- temporary debugging state;
- repeated verification;
- environment investigation;
- exploratory research.

That material is useful while reasoning, but much of it should not remain permanently in the main model context.

Yokodori therefore separates:

1. raw evidence;
2. canonical cognitive and metacognitive state;
3. effective model context;
4. reasoning topology.

The product is not a generic prompt builder or summarizer. It is a semantic context-control plane.

## 2. Authority boundary

Yokodori is the authority for **effective model context** inside an admitted AgentRun.

It owns:

- deterministic initial-context compilation;
- model-visible context selection and projection;
- semantic normalization and canonicalization;
- bounded context compression;
- external metacognitive observation;
- semantic trajectory state;
- context paging and evidence rehydration;
- fork-context construction and merge policy;
- provider-cache-aware context layout;
- harness-specific context interception adapters;
- requests to semantic inference services such as Hachidori/Clef.

Yokodori does not own:

- task decomposition or scheduling;
- AgentRun identity or lifecycle;
- physical process ownership;
- worktree, branch, filesystem, or Git authority;
- GitHub Issue/PR governance;
- architecture semantics;
- coding-policy semantics;
- correctness of a task result;
- provider model execution itself.

One semantic fact must have one owner. Yokodori may consume facts owned elsewhere, but it must not silently become their source of truth.

## 3. Position in the product architecture

The primary coding-agent stack is:

```text
Mottainai
  task decomposition / assignment / scheduling / orchestration / evaluation
      |
      v
Tsukai
  AgentRun identity / lineage / lifecycle / harness binding / result / factual observation
      |
      +--------------------+----------------------+
      |                    |                      |
      v                    v                      v
Yokodori               Nawabari               Jinushi
cognition/context      workspace/Git          physical execution
authority              authority              authority
      |                                           |
      v                                           v
Pi adapter / harness                          OS process tree
      |
      v
Pi
      |
      v
model/provider
```

This diagram is a composition graph, not a claim that all three lower authorities are children of Tsukai in the same sense.

### 3.1 Mottainai

Mottainai remains the top-level orchestration authority.

It owns:

- task decomposition;
- assignment;
- scheduling;
- multi-agent coordination;
- workflow policy;
- task/result evaluation.

It should not retain a duplicate AgentRun registry or become the owner of model-visible context once Tsukai and Yokodori are adopted.

The long-term boundary is:

```text
Mottainai decides what work should happen.
Tsukai decides what AgentRun exists and what happened to it.
Yokodori decides what the model should see and what the observed cognition means.
```

### 3.2 Tsukai

Tsukai owns the AgentRun.

It is the lifecycle and factual-observation authority for:

- AgentRun identity;
- lineage;
- semantic lifecycle;
- harness binding;
- result and receipt references;
- cancellation semantics;
- event journals;
- deterministic factual projections.

Tsukai must remain useful without Yokodori. Yokodori is an optional cognitive/context capability attached to an admitted execution profile, not a prerequisite for basic AgentRun execution.

Tsukai supplies Yokodori with bounded run identity and observation streams. Yokodori must not mutate Tsukai lifecycle state by inference alone.

### 3.3 Nawabari

Nawabari owns where repository work may occur.

It owns:

- workspace sessions;
- worktrees;
- mutable branches;
- filesystem/Git scope;
- claims;
- workspace admission;
- local repository recovery.

Yokodori may observe branch/workspace facts and compile them into model context, but those facts remain Nawabari/Git authority.

### 3.4 Jinushi

Jinushi owns the physical execution.

It owns:

- Run identity;
- process tree;
- stdin/stdout/stderr/PTY;
- resource limits;
- physical process observation;
- termination;
- reconciliation;
- terminal execution receipt.

Yokodori does not manage processes. Tsukai composes Yokodori's cognitive capability with Jinushi's execution capability.

### 3.5 Pi and harness adapters

Pi is the initial harness target.

The Yokodori product must not be defined as "a Pi extension". Pi integration is an adapter.

The intended boundary is:

```text
Yokodori Core
  compiler
  canonical state
  semantic observation
  metacognition
  compression
  fork policy
  evidence paging
      |
      v
adapters/pi
  harness-specific interception
  session initialization
  context projection
  tool-result observation
  fork mapping
      |
      v
Pi
```

This keeps the core useful if the harness changes later.

Exact Pi hook names and contracts are implementation-time dependencies and must be verified against the then-current authoritative Pi documentation before implementation.

## 4. Repository and engineering authorities

Yokodori consumes repository semantics but does not own them.

### 4.1 Wabachi

Wabachi owns architecture semantics and explicit Architecture Canon material.

Yokodori may include relevant architecture/domain facts in effective context, but the source remains Wabachi or the repository Architecture Canon.

### 4.2 Shikitari

Shikitari owns tool-independent semantic coding policy.

Yokodori may compile applicable naming, formatting, coding, or semantic constraints into a session context. It must not redefine those rules.

### 4.3 Inari

Inari owns governed GitHub semantics and mutation authority.

This includes repository Canon, Issue/Implementation/PR contracts, admission, authorized provider effects, and outcome verification.

Yokodori may include task authority and constraints derived from Inari artifacts. It must not create an alternate GitHub-governance interpretation.

### 4.4 Suzukuri

Suzukuri owns deterministic bounded semantic views and verification evidence for repository sources and commands.

Yokodori may consume Suzukuri projections as bounded evidence instead of injecting large raw source/output payloads.

## 5. Hachidori and Clef

Hachidori is a local semantic inference runtime.

It turns text or state into small typed semantic signals quickly and reproducibly. It does not own orchestration or context policy.

Yokodori is expected to become a primary architectural consumer of Hachidori/Clef.

The division is:

```text
Yokodori
  owns semantic state and context-control policy
      |
      v
Hachidori / Clef
  performs requested semantic inference
```

Clef can act as the higher-order metacognitive controller, but its output remains an input to Yokodori policy rather than an independent authority over AgentRun, workspace, or process state.

## 6. Three-state context model

Yokodori keeps three representations separate.

### 6.1 Raw History

Raw History is evidence.

It may contain:

- assistant messages;
- tool invocations;
- tool results;
- harness events;
- selected stdout/stderr;
- runtime events;
- Git/repository observations.

Raw History is not automatically the model context and should not be rewritten merely to save tokens.

### 6.2 Canonical Cognitive and Metacognitive State

This is the durable normalized representation of what matters.

Examples:

```text
GOAL: IMPLEMENT ADAPTIVE BATCHING.
ACTIVITY: DEBUG.
CURRENT HYPOTHESIS: TIMER DOES NOT FLUSH THE BATCH.
CONFIDENCE: MEDIUM.
NEW EVIDENCE: NONE.
REPEATED ACTION: 3.
NEXT ACTION: GET NEW EVIDENCE.
```

The exact schema may evolve. The invariant is that semantically equivalent session states should converge toward the same or near-identical canonical representation.

### 6.3 Effective Model Context

Effective Context is generated per model request.

It is a projection of:

- stable authority and domain context;
- current canonical cognitive/metacognitive state;
- selected evidence;
- the immediate task.

It is not required to equal stored session history.

This is semantic context virtualization:

```text
Raw History
   |
   +--> canonicalization --> Canonical State
   |
   +--> evidence index / paging
                              |
                              v
                   Effective Model Context
                              |
                              v
                            Model
```

## 7. Initial context compiler

The first production capability should be deterministic initial-context compilation.

Before the first model request, Yokodori constructs a stable session prefix from explicit sources.

Initial sources should include, where available:

1. AGENTS.md and repository agent instructions;
2. controlled vocabulary / canonical language policy;
3. required skills;
4. domain information;
5. architecture declarations;
6. constraints and authority;
7. repository and branch state;
8. task / Issue / Implementation identity.

The compiler should prefer typed structured input over a caller-provided giant prompt.

A conceptual request is:

```text
SessionInit
  repository
  task
  authority
  branch
  constraints
  skills
  domain
  context_policy
```

The compiler resolves those references and produces the harness-specific initial projection.

The important property is:

> The same admitted inputs and repository state must produce the same canonical initial context bytes, apart from explicitly volatile fields.

## 8. Stable and volatile context

Prompt-cache efficiency and semantic stability require explicit separation.

A typical layout is:

```text
[stable prefix]
  agent protocol
  controlled vocabulary
  AGENTS policy
  required skills
  architecture/domain invariants
  authority
  constraints

[session initialization]
  task
  repository
  branch
  HEAD / workspace identity

[volatile projection]
  current canonical state
  selected recent evidence
  current request
```

Stable material should not be gratuitously rewritten between turns.

Provider prompt caching is an optimization, never correctness authority. Cache behavior must be measured for the actual provider/model/runtime combination.

## 9. Controlled language and cognitive compression

Free-form narration is expensive and unstable.

Yokodori should use a constrained canonical language inspired by ASD-STE100 principles, without claiming formal STE100 compliance.

The objective is not stylistic simplification. It is representational stability.

For example:

```text
"I'll inspect X."
"I still think X is relevant."
"Let me inspect X again."
"X still seems likely."
"I haven't found another explanation."
```

can normalize into:

```text
HYPOTHESIS: X.
CONFIDENCE: STABLE.
NEW EVIDENCE: NONE.
REPEATED INSPECTION: 3.
```

This is cognitive compression or metacognitive folding.

The target chain is:

```text
semantic equivalence
    ->
representational equivalence
    ->
token-prefix equivalence
```

A useful evaluation metric is therefore not only token reduction, but also the percentage of semantically equivalent states that converge to identical canonical token sequences.

## 10. Semantic observation

The initial semantic sensor should be cheap and continuously available.

The first useful classification may simply be:

- IMPLEMENT
- TEST
- DEBUG
- RESEARCH
- REVIEW
- WAIT
- INTEGRATE
- VERIFY
- RELEASE
- OTHER

Prefer runtime-native event boundaries:

- assistant message;
- tool invocation;
- tool result;
- stdout/stderr chunk;
- process event;
- Git/runtime event.

Do not require a sophisticated semantic parser before observation. That would move the hard problem upstream.

A Linux-first resident Probe is acceptable for the initial implementation.

## 11. Semantic trajectory

Yokodori should observe more than categorical activity.

Useful signals include:

- semantic position;
- semantic velocity;
- recurrence;
- novelty;
- distance from session baseline;
- local loops;
- regime/change points;
- trajectory expansion;
- unexpected termination.

Example trajectories:

```text
healthy:
A -> B -> C -> D -> E -> DONE

loop:
A -> B -> C -> D -> C' -> D' -> C''

scope expansion:
A -> B -> C -> D -> E -> F -> G ...

regime transition:
A -> B -> C -> X
```

The Probe reports the waveform. It does not decide whether the waveform is acceptable.

## 12. True external metacognition

Activity classification is not metacognition.

Yokodori should estimate the state and quality of cognition itself.

Signals include:

- uncertainty movement;
- hypothesis change;
- evidence novelty;
- action repetition;
- semantic novelty;
- contradiction;
- unresolvedness;
- premature commitment;
- whether the current context remains productive;
- expected value of another attempt in the same context.

Long DEBUG activity is not inherently bad if hypotheses and evidence continue to evolve.

Different natural-language wording is not evidence of epistemic progress.

For example:

```text
H1 confidence=.55 evidence=E1
H1 confidence=.58 evidence=E1
H1 confidence=.60 evidence=E1
```

shows little real progress despite changing text.

A healthier trajectory is:

```text
H1 confidence=.70
  -> contradictory evidence
H1 confidence=.20
  -> new hypothesis
H2 confidence=.60
  -> new evidence
H2 confidence=.90
```

The model's own claims are observable, fallible data rather than privileged truth.

## 13. Fork as speculative cognitive execution

Most work should get one attempt in the main context.

If the work resolves, continue normally.

If it remains unresolved, Yokodori/Clef may choose among:

- CONTINUE_MAIN;
- RETRY;
- RECONSIDER;
- FORK_CURRENT_CONTEXT;
- DELEGATE_NEW_AGENT;
- STOP / ESCALATE.

A fork is a short-lived speculative cognitive transaction.

It inherits useful context, performs disposable reasoning, and returns only durable information.

A fork may contain:

- stack traces;
- grep output;
- failed hypotheses;
- repeated tests;
- temporary edits;
- environment debugging;
- upstream research.

The parent should receive only:

- status/result;
- cause;
- evidence;
- relevant decisions;
- filesystem/Git delta;
- unresolved questions.

The complete reasoning history should not be merged into the parent by default.

## 14. Fork versus fresh delegation

There are three distinct execution topologies.

### Main

Default for one-shot work.

### Fork

Use when inherited context is valuable but the next reasoning path may be disposable or noisy.

### Fresh agent

Use when work is genuinely independent and the cost of handoff is justified.

The controller should choose based on expected value, not merely elapsed time or an activity label.

## 15. Prefix-cache interaction

A fork does not imply that the runtime can clone provider KV cache.

The desired property is simpler: forks preserve a common prompt prefix so a provider with prefix caching may reuse it.

Conceptually:

```text
Parent prefix P
  |
  +-- Fork A: P + debug A
  +-- Fork B: P + research B
  +-- Fork C: P + verification C
```

The parent can retain:

```text
P + durable result R
```

instead of:

```text
P + attempt1 + output + attempt2 + output + ... + R
```

Cache reuse must be measured and must never become a correctness dependency.

## 16. Physical pseudo-MoE

The architecture resembles a physically separated sparse mixture of experts.

```text
event / task
    |
    v
cheap Probe
    |
    v
Yokodori / Clef router
    |
    +-- main context
    +-- fork context A
    +-- fork context B
    +-- fresh agent
    +-- specialist semantic model
    |
    v
canonical result merge
```

The experts are not neural-network FFN blocks. They are separate contexts, processes, models, or specialists with different cost profiles.

This creates real sparse compute: expensive reasoning is activated only when needed.

## 17. Compute hierarchy

A plausible hierarchy is:

### L0 — deterministic sensors

- process state;
- exit codes;
- hashes;
- counters;
- timestamps;
- filesystem/Git state.

### L1 — always-on semantic sensor

- small CPU encoder;
- activity classification;
- semantic fingerprints;
- trajectory metrics.

### L2 — conditional specialist

- stronger classifier;
- longer-context encoder;
- domain-specific semantic head.

### L3 — Clef metacognitive control

- interpret semantic state;
- estimate progress/productivity;
- decide context allocation.

### L4 — general agent reasoning

- main agent;
- fork;
- delegated agent.

## 18. Probe implementation target

Initial deployment may be Linux-only.

One resident Probe per host can observe multiple AgentRuns and microbatch inference when useful.

Initial performance targets:

- CPU-only resident encoder;
- p50 < 20 ms;
- p95 < 50 ms;
- p99 < 100 ms;
- >= 100 semantic events/sec;
- near-zero idle CPU;
- RAM < 256 MB;
- small per-AgentRun state.

Candidate field-of-view limits to benchmark:

- 32 tokens;
- 64 tokens;
- 128 tokens;
- 256 tokens.

A short field of view is not the memory model; durable memory is the canonical state.

Candidate initial encoders include MiniLM-L6-v2 and multilingual-E5-small, with stronger specialists only when measurement shows the need.

Float, int8, and binary representations should be benchmarked.

A 384-dimensional representation is approximately:

- float32: 1536 bytes;
- int8: 384 bytes;
- binary: 48 bytes.

Binary fingerprints can make recurrence checks cheap, but semantic similarity must not be mistaken for exact canonical identity.

## 19. Failure semantics

Yokodori is an interpretation and context-projection layer. It must fail without corrupting lower-level truth.

Required principles:

1. Tsukai factual observation remains authoritative even if Yokodori is unavailable.
2. Nawabari workspace authority remains unchanged by semantic inference.
3. Jinushi process state remains unchanged by semantic inference.
4. Raw evidence is not silently destroyed because a compressed projection exists.
5. A classification or metacognitive estimate must not fabricate physical facts.
6. Cache misses or provider cache behavior never alter correctness.
7. Context compression must expose loss/completeness information where material.
8. A failed fork must not silently merge reasoning or filesystem mutations into the parent.
9. Rehydration must retrieve evidence by stable references rather than model-invented identifiers.
10. Semantic uncertainty should remain explicit.

Initial implementation should support a shadow mode where Yokodori computes the context it would have sent, but does not yet alter the harness request. This enables A/B measurement before making context interception authoritative.

## 20. Persistence model

Yokodori should persist only durable state required for context reconstruction and metacognitive continuity.

Potential durable material:

- canonical session/context identity;
- canonical cognitive/metacognitive state;
- evidence references and fingerprints;
- semantic trajectory summaries;
- fork lineage and returned canonical results;
- compiler input identities/digests;
- effective-context digest;
- compression/loss metadata.

Raw transcripts may remain owned by the harness/Tsukai or separate evidence storage.

Yokodori should avoid becoming a second canonical transcript database unless an explicit future requirement justifies that authority.

## 21. Initial package shape

A reasonable initial structure is:

```text
src/
  core/
    context/
    canonical/
    metacognition/
    compression/
    evidence/
    fork/
  protocol/
  compiler/
  probe/
  adapters/
    pi/
```

The structure is illustrative. Responsibility boundaries are authoritative; package names are not.

The core must not import Pi implementation details.

## 22. Initial implementation sequence

### Phase 1 — Initial Context Compiler

- structured SessionInit input;
- deterministic source resolution;
- stable section ordering;
- controlled vocabulary;
- canonical initial model context;
- context digest.

### Phase 2 — Observation and shadow projection

- consume Tsukai/harness observations;
- semantic Probe;
- activity classification;
- semantic trajectory;
- compute hypothetical effective context without altering execution.

### Phase 3 — Context interception

- Pi adapter;
- replace/project model-visible context before provider request;
- preserve raw evidence;
- deterministic compression and selected evidence;
- token/cache instrumentation.

### Phase 4 — External metacognition

- canonical cognitive state;
- evidence novelty;
- recurrence;
- hypothesis/confidence tracking;
- stagnation/productivity signals;
- Clef integration.

### Phase 5 — Fork runtime integration

- parent canonical-state inheritance;
- fork-local effective context;
- canonical return contract;
- discard/merge semantics;
- provider-cache measurements.

### Phase 6 — Context virtualization

- evidence paging;
- rehydration;
- durable semantic references;
- stable-prefix optimization;
- long-session token-budget control.

## 23. Evaluation

Yokodori must be justified by measured behavior.

Primary metrics:

- transmitted tokens per completed task;
- effective-context size;
- stable-prefix length;
- provider cache-read/cache-write behavior where available;
- completion rate;
- task correctness/verification rate;
- number of turns;
- fork frequency;
- fresh-agent delegation frequency;
- handoff size;
- semantic-state convergence rate;
- false intervention rate;
- context-rehydration rate;
- Probe CPU/RSS/latency;
- percentage of semantically equivalent states rendered to identical canonical tokens.

The design fails if it reduces token count while materially reducing task correctness or hiding evidence required for recovery.

## 24. Design principles

1. One-shot success stays cheap.
2. Raw history is evidence, not automatically context.
3. Stable semantic state should not be rewritten as variable prose.
4. The model's own narration is observable and fallible.
5. Preserve physical facts; normalize semantic state.
6. Separate cognition from metacognition.
7. Fork before fresh handoff when inherited context has high value.
8. Disposable reasoning should not pollute durable context.
9. Clef decides context allocation; it need not solve every task.
10. Provider caching is an optimization, never authority.
11. Yokodori may consume another product's Canon but must not duplicate its authority.
12. Start with deterministic compilation and shadow measurement before authoritative interception.
13. Prefer bounded, typed contracts over free-form prompt conventions.
14. Keep the Pi integration replaceable.
15. Make uncertainty and information loss explicit.

## 25. Long-term objective

The long-term architecture separates work orchestration, AgentRun lifecycle, cognition, workspace authority, and process execution into independent truth domains.

```text
Mottainai
  what work should happen
      |
      v
Tsukai
  what AgentRun exists and what happened to it
      |
      +--> Yokodori
      |      what the model should see
      |      and what observed cognition means
      |
      +--> Nawabari
      |      where repository work may mutate
      |
      +--> Jinushi
             what process physically runs
```

Repository semantics remain orthogonal:

```text
Wabachi   = what the architecture means
Shikitari = what compliant code means
Inari     = what GitHub/repository operation is authorized
Suzukuri  = what bounded source/verification evidence says
```

Yokodori is the bridge between those durable facts and the probabilistic reasoning loop.

Its defining responsibility is therefore:

> **Own the model-visible context without owning the truths from which that context is compiled.**

## 26. Resident observability plane

Epic #24 proposes the next architectural layer after the certified Pi context boundary: an independent local Yokodori daemon with a first-party read-only dashboard.

The daemon extends Yokodori from an in-process context capability into a harness-agnostic semantic observation runtime without changing the existing authority model.

The intended composition is:

```text
Pi adapter / future harness adapters
             |
             | canonical observation events
             v
      Yokodori daemon
        observation projection
        checkpoint correlation
        Git evidence correlation
        execution lineage
        async semantic classification
             |
             +--> Hachidori
             |
             v
        HTML dashboard
```

The daemon does not own or supervise agent execution. Pi/harness execution continues if the daemon is unavailable. Context injection remains at the supported adapter boundary rather than moving into the daemon.

A Yokodori observation stream is not automatically an AgentRun. When Tsukai identity is available, it is carried as an external authority reference.

The daemon must preserve the provenance and trust class of observations:

- Git/runtime observations are externally sourced facts;
- digest equality and completeness are Yokodori certification results;
- checkpoints are explicit agent/user declarations;
- Hachidori labels are probabilistic inference with classifier/version/confidence.

These classes must not be flattened into one apparent certainty level.

Checkpoint commits are expected to provide sparse, high-confidence semantic anchors. Message-level Hachidori classifications fill the execution trail between checkpoints. A later fork is represented as lineage between observation streams; Yokodori need not own the mechanism that created it.

The first dashboard is read-only and execution-centered. Its primary information hierarchy is:

1. repository / branch / HEAD;
2. current stream and latest checkpoint;
3. event/message trail since that checkpoint;
4. semantic classifications;
5. context injection/observation/certification;
6. parent/child lineage.

Daemon health, protocol version, socket paths, and full digest values are secondary diagnostics rather than the primary visual hierarchy.

Raw model-visible context remains sensitive and is not persisted or exposed by default. Initial daemon state should be bounded and in-memory. Durable semantic history requires an explicit later persistence/privacy contract.

Adapter-to-daemon communication uses a versioned canonical observation protocol whose semantic schema is independent from its local transport. Pi-native hooks and message types remain confined to the Pi adapter.

The detailed proposed architecture and Wave sequencing are defined in `docs/epics/0002-daemon-dashboard-observability-plane.md`. Wave 0 is tracked by #25.
