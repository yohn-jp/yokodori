# Epic Architecture: Daemon-backed Observability and Dashboard

Status: proposed architecture  
Date: 2026-10-04  
Epic: #24  
Wave 0: #25

## 1. Objective

Yokodori's first executable slice proved a narrow but important contract:

- compile admitted context deterministically;
- inject it through a supported harness boundary;
- observe the injected section at the supported model-context boundary;
- certify the observed bytes against the compiled bytes.

That contract remains valid.

The next step is to make the resulting evidence useful across a complete agent execution rather than only inside one Pi extension instance.

This Epic introduces a resident local Yokodori daemon and a first-party HTML dashboard.

The daemon is not a new execution authority. It is a harness-agnostic semantic observation runtime that receives bounded events from adapters, maintains a local projection of current execution state, correlates semantic observations with Git and explicit checkpoints, delegates cheap classification to Hachidori, and exposes the result through one dashboard.

The product transition is:

```text
Yokodori 0.1.x
  deterministic context compiler
  + Pi injection/observation adapter
          |
          v
Yokodori daemon architecture
  adapter-neutral observation protocol
  + multi-stream local projection
  + checkpoint/Git correlation
  + semantic classification
  + execution lineage
  + read-only dashboard
```

Pi remains the first supported adapter. It is no longer the shape of the product.

## 2. Product thesis extension

The Architecture Canon states:

> Yokodori owns the model-visible context without owning the truths from which that context is compiled.

The daemon adds a second, compatible responsibility:

> Yokodori owns the semantic observation projection of an agent execution without owning the execution or the external facts being observed.

This distinction is critical.

The daemon may know:

- what a model-visible context digest was;
- what request sequence was observed;
- what branch/HEAD Git reported;
- what an agent declared at a checkpoint;
- what Hachidori classified a message as;
- what parent/child relationship an adapter reported.

It must not silently convert those observations into authority over:

- AgentRun lifecycle;
- Git state;
- workspace state;
- physical process state;
- task orchestration;
- task correctness.

The daemon is therefore an interpretation and projection layer over explicit evidence.

## 3. Target architecture

```text
                         local host
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│  Pi process               future harness            custom client │
│  ┌──────────────┐         ┌──────────────┐          ┌───────────┐  │
│  │ Yokodori Pi  │         │ Yokodori     │          │ Yokodori  │  │
│  │ adapter      │         │ adapter      │          │ adapter   │  │
│  └──────┬───────┘         └──────┬───────┘          └─────┬─────┘  │
│         │                          │                         │        │
│         └──────────── canonical observation protocol ───────┘        │
│                                    │                                 │
│                                    v                                 │
│                       ┌─────────────────────────┐                     │
│                       │ Yokodori daemon         │                     │
│                       │                         │                     │
│                       │ protocol admission      │                     │
│                       │ event journal (bounded) │                     │
│                       │ stream projections      │                     │
│                       │ Git correlation         │                     │
│                       │ checkpoint projection   │                     │
│                       │ lineage projection      │                     │
│                       │ classification queue    │                     │
│                       └─────────┬───────┬───────┘                     │
│                                 │       │                             │
│                         async   │       │ loopback HTTP               │
│                                 v       v                             │
│                         ┌───────────┐  ┌─────────────────────────┐    │
│                         │ Hachidori │  │ HTML dashboard          │    │
│                         └───────────┘  │ read-only projection    │    │
│                                        └─────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

No hosted service is required.

Cross-host federation is not required for the first Epic.

## 4. Authority boundary

### 4.1 Daemon owns

The daemon owns:

- admission/validation of the Yokodori observation protocol;
- local observation-stream identity when no external identity is supplied;
- ordering and de-duplication of admitted Yokodori events;
- bounded event retention for its active lifetime;
- derived current-state projections;
- classification requests/results owned by Yokodori;
- checkpoint correlation;
- execution-lineage projection;
- dashboard rendering/API projection.

### 4.2 Daemon does not own

The daemon does not own:

- Pi process/session lifecycle;
- Tsukai AgentRun identity/lifecycle;
- Git repository truth;
- Nawabari workspace authority;
- Jinushi process authority;
- Mottainai orchestration;
- provider/model execution;
- provider credentials;
- Git mutation;
- checkpoint commit creation unless a future accepted capability explicitly assigns such a command path;
- correctness of checkpoint claims;
- correctness of semantic classifications.

### 4.3 Provenance rule

Every externally sourced fact must preserve its provenance.

Examples:

```text
Git HEAD = observed fact from Git/adaptor
checkpoint summary = explicit agent declaration
activity=DEBUG, score=.92 = Hachidori inference
context digest MATCH = Yokodori certification result
AgentRun id = external authority reference when supplied by Tsukai
```

The dashboard must make these categories distinguishable.

## 5. Process model

The daemon is an independent process.

It must be possible to start it with no Pi process and no Hachidori process running.

Conceptually:

```text
yokodori daemon
```

is the process entrypoint.

The exact executable/package surface is decided by Wave 0, but it must remain intentionally narrow.

The daemon is not responsible for supervising connected agents.

If Pi exits, the daemon can remain running.

If the daemon exits, Pi must continue to execute according to Pi's own contract.

## 6. Adapter model

An adapter translates harness-specific observations into canonical Yokodori events.

The adapter is responsible for:

- understanding the harness lifecycle;
- understanding the harness message/event types;
- selecting supported observation boundaries;
- translating those facts into the Yokodori protocol;
- preserving completeness/fidelity metadata;
- failing without blocking the harness where the underlying observation is non-authoritative.

The daemon must not import harness-specific packages.

Pi-specific imports remain under:

```text
src/adapters/pi/**
```

Future adapters must not require changes to the semantic meaning of existing canonical events merely because their native APIs differ.

## 7. Canonical observation protocol

The durable contract is the event model, not the transport.

A conceptual envelope is:

```ts
interface ObservationEventV1 {
  readonly version: 1;
  readonly eventId: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly kind: ObservationEventKind;
  readonly observedAt: string;
  readonly source: {
    readonly adapter: string;
    readonly adapterVersion?: string;
    readonly harness?: string;
  };
  readonly completeness?: "complete" | "partial" | "unknown";
  readonly payload: unknown;
}
```

Required properties:

1. event identity is stable for retry/de-duplication;
2. stream sequence is monotonic;
3. schema version is explicit;
4. source/provenance is explicit;
5. unknown/partial evidence is represented explicitly;
6. Pi-native types are not part of the canonical schema.

## 8. Stream identity

A stream is a Yokodori observation stream.

It is not automatically an AgentRun.

A stream may reference externally authoritative identities:

```ts
interface StreamReference {
  readonly streamId: string;
  readonly externalRun?: {
    readonly authority: "tsukai" | string;
    readonly id: string;
  };
  readonly harness?: {
    readonly kind: "pi" | string;
    readonly sessionId?: string;
  };
  readonly repository?: {
    readonly identity?: string;
    readonly workingDirectory?: string;
  };
  readonly parentStreamId?: string;
}
```

When Tsukai is present, Tsukai remains the owner of AgentRun identity.

When Tsukai is absent, Yokodori may generate a local observation-stream identity without claiming it is a globally authoritative AgentRun ID.

## 9. Initial event families

The canonical model is expected to support the following semantic event families.

### 9.1 Stream lifecycle

```text
stream.opened
stream.closed
```

These establish and close observation-stream state.

### 9.2 Context evidence

```text
context.compiled
context.injected
context.observed
```

These preserve the already proven context path.

Representative fields include:

- renderer/compiler version;
- source count;
- compiled digest;
- injection boundary/mode;
- request sequence;
- observation boundary;
- observed digest;
- completeness;
- certification result.

Raw model-visible context is not required by the daemon protocol for routine certification.

### 9.3 Messages

```text
message.observed
```

This is the semantic unit later used for classification.

The canonical event must retain enough information to distinguish at least:

- user;
- assistant;
- tool/system where supported;
- message sequence/reference;
- bounded content or a content reference according to privacy policy.

Wave 0 does not require full message ingestion.

### 9.4 Checkpoints

```text
checkpoint.declared
```

A checkpoint is an explicit declaration, not an inference.

Representative payload:

```ts
interface CheckpointDeclared {
  readonly checkpointId: string;
  readonly summary: string;
  readonly achieved?: readonly string[];
  readonly next?: readonly string[];
  readonly state?: string;
  readonly gitCommit?: string;
  readonly declaredBy: "agent" | "user" | "external";
}
```

The schema should remain concise.

A checkpoint is intended to be a high-confidence semantic anchor between stretches of noisier message-level evidence.

### 9.5 Git observations

```text
git.observed
```

Representative fields:

- repository identity/root;
- branch/ref;
- HEAD;
- dirty/clean/unknown;
- optional changed-path counts;
- observation source/time.

This event is read-only evidence.

Yokodori must not convert a Git observation into mutation authority.

### 9.6 Classifications

```text
classification.observed
```

A classification references a source event.

Representative shape:

```ts
interface ClassificationObserved {
  readonly sourceEventId: string;
  readonly classifier: {
    readonly id: string;
    readonly version: string;
  };
  readonly axis: string;
  readonly choices: readonly {
    readonly value: string;
    readonly score: number;
  }[];
}
```

The exact Hachidori response shape remains adapter/service-specific. Yokodori stores a canonical semantic result.

### 9.7 Lineage

```text
execution.forked
```

Representative payload:

```ts
interface ExecutionForked {
  readonly parentStreamId: string;
  readonly childStreamId: string;
  readonly checkpointId?: string;
  readonly gitHead?: string;
  readonly reason?: string;
}
```

The event records reported lineage.

It does not imply Yokodori created or owns the fork.

## 10. Trust model

Yokodori must not flatten heterogeneous evidence into one undifferentiated state.

The dashboard and internal model distinguish at least four trust classes.

### 10.1 Physical/external observation

Examples:

- Git HEAD;
- branch;
- process/harness-provided session ID;
- request boundary observed.

These are factual observations with explicit source authority.

### 10.2 Yokodori certification

Examples:

- compiled digest;
- observed digest;
- exact MATCH/MISMATCH;
- sequence completeness.

These are deterministic conclusions over admitted evidence.

### 10.3 Explicit declaration

Examples:

- agent checkpoint summary;
- declared next action;
- user annotation.

These are semantically strong because the source intentionally declared them, but they are not correctness proofs.

### 10.4 Probabilistic inference

Examples:

- Hachidori activity tag;
- intent tag;
- domain classification;
- execution-state classification.

These always retain classifier version and confidence.

This hierarchy is important for UI design.

A .95 classifier result must not visually look more authoritative than an exact digest match or a Git HEAD observation.

## 11. Checkpoints as semantic anchors

Checkpoint commits are the sparse high-confidence structure of the execution timeline.

The intended model is:

```text
Checkpoint A
  commit abc1234
  "manifest validation complete"
      |
      +-- inspect      package entrypoint
      +-- investigate  path escape
      +-- implement    validator
      +-- test         duplicate rank
      +-- fix          windows path handling
      |
Checkpoint B
  commit def5678
  "manifest admission complete"
```

The checkpoint itself comes from an explicit agent declaration.

Message-level classification fills the interval.

This has two architectural benefits:

1. semantic-classification errors do not accumulate indefinitely because later explicit anchors re-ground the timeline;
2. users can correlate semantic progress with durable Git state without requiring every message to be treated as high-confidence state.

The daemon should therefore model checkpoints as first-class objects rather than special message tags.

## 12. Hachidori classification model

Hachidori is asynchronous semantic infrastructure.

The agent request path must not wait for classification.

The expected flow is:

```text
message observed
      |
      +--------------------------> agent continues
      |
      v
Yokodori daemon
      |
      +--> classification queue
                |
                v
             Hachidori
                |
                v
      classification.observed
                |
                v
           dashboard update
```

Initial useful axes may include:

### Activity

```text
IMPLEMENT
TEST
DEBUG
RESEARCH
REVIEW
VERIFY
INTEGRATE
RELEASE
WAIT
OTHER
```

### Intent

```text
INSTRUCTION
QUESTION
CORRECTION
APPROVAL
REJECTION
PROPOSAL
EXPLANATION
OTHER
```

### Execution state

```text
EXPLORATION
DECISION
IMPLEMENTATION
VERIFICATION
BLOCKED
OTHER
```

### Domain

Repository/product-specific values may be supplied as bounded choices.

Classifier sets are configuration, not hard-coded global truth.

The result must record classifier/version so labels can be reinterpreted or re-run later without pretending older predictions came from the current model.

## 13. Git correlation

Git information belongs near the top of the dashboard because it provides a durable physical anchor for coding-agent work.

The minimum useful representation is:

```text
repository · branch · HEAD · clean/dirty
```

Checkpoint rows may additionally show their associated commit.

The daemon may consume Git observations emitted by adapters or a future bounded Git observer.

It must not mutate Git in this Epic.

A later checkpoint-commit feature may request Git mutation through the actual Git/workspace authority. That is a separate capability.

## 14. Fork and multi-stream topology

The daemon exists partly to eliminate one-dashboard-per-Pi fragmentation.

Multiple connected agents become streams in one local graph.

```text
                     stream B / Pi
                    /
checkpoint A ------+
                    \
                     stream C / future adapter
```

The graph should preserve:

- parent stream;
- child stream;
- fork point/checkpoint when known;
- Git HEAD at branch point when known;
- harness/adapter identity;
- current online/offline/closed observation state.

The daemon does not need to understand how the harness implemented the fork.

It only needs an explicit lineage report.

Cross-daemon links may be added later if separate hosts are required.

## 15. Dashboard information architecture

The dashboard is an execution-observation product, not an infrastructure status page.

The first screen should answer:

1. What repository and Git state am I looking at?
2. Which agent/stream is active?
3. What was the last reliable checkpoint?
4. What has happened since that checkpoint?
5. What is Yokodori inferring those messages/actions represent?
6. Is the model context currently certified?
7. Did execution fork, and where are the child streams?

A target layout is:

```text
YOKODORI
repo · branch · HEAD · clean                    stream / adapter / state

Execution
──────────────────────────────────────────────────────────

● checkpoint #7 · abc1234
│ manifest admission complete
│
├─ 20:11 inspect       adapter/package
├─ 20:12 investigate   symlink escape
├─ 20:13 implement     validation
├─ 20:14 test          duplicate rank
├─ 20:16 verify        package tests
│
● checkpoint #8 · def5678
│ Pi injection wiring complete
│
├────────────── fork ──────────────┐
│                                  │
│ main                             │ child / Pi
│ ...                              │ ...

Context certification
sources 3 · request #12 · context_with_system · MATCH
```

## 16. Dashboard visual priorities

The interface should allocate most of its visual area to the execution timeline.

The following should be compact secondary elements:

- daemon health;
- protocol version;
- digests;
- source count;
- endpoint metadata.

The following should be visually primary:

- checkpoints;
- current semantic activity;
- message/event trail;
- Git anchors;
- branches/forks.

Raw context should not become a default inspector merely because the browser makes it easy to display.

## 17. Read-only first

The dashboard is read-only for this Epic.

No buttons should:

- mutate Git;
- cancel agents;
- create forks;
- alter model context;
- edit checkpoints;
- trigger provider execution.

The only interactive behavior needed initially is navigation/filtering within already observed data.

This prevents the observability plane from accidentally becoming a second control plane.

## 18. Local transport

Wave 0 should separate ingestion transport from browser transport.

Recommended shape:

```text
adapter -> local IPC -> daemon
browser -> loopback HTTP -> daemon
```

On Linux/NixOS, a Unix-domain socket is the preferred ingestion transport.

A runtime endpoint descriptor can expose the active socket and dashboard endpoint.

Example conceptual descriptor:

```json
{
  "version": 1,
  "pid": 12345,
  "protocol": 1,
  "ingest": {
    "transport": "unix",
    "path": "/run/user/1000/yokodori/daemon.sock"
  },
  "dashboard": {
    "url": "http://127.0.0.1:43120/"
  }
}
```

The concrete path/port is not architecture authority.

The durable contract is:

- local only by default;
- discoverable;
- versioned;
- no hard-coded globally fixed port requirement;
- browser served through loopback;
- remote/tunnel automation deferred.

## 19. Live update transport

For the dashboard, server-sent events are a suitable initial mechanism because the first UI is read-only and daemon-to-browser updates dominate.

Conceptually:

```text
GET /api/v1/snapshot
GET /api/v1/events   (SSE)
```

A WebSocket is not required merely for future possibilities.

If later dashboard control is accepted, the transport may evolve without changing the observation-event model.

## 20. Daemon state model

Wave 0 should keep state deliberately small.

Suggested projections:

```text
DaemonProjection
  protocolVersion
  startedAt
  streams: Map<streamId, StreamProjection>

StreamProjection
  identity
  adapter
  openedAt
  closedAt?
  git?
  context?
  latestSequence
  timeline[]
  future:
    latestCheckpoint?
    classificationsByEvent?
    children[]
```

The projection is derived state.

The event envelope remains the primary protocol evidence.

## 21. Persistence boundary

Wave 0 uses bounded in-memory state.

A small endpoint descriptor is allowed for daemon discovery.

Do not persist by default:

- raw messages;
- raw model-visible context;
- complete transcripts;
- Hachidori input text.

A later persistence Wave may retain:

- checkpoint metadata;
- classification results;
- semantic summaries;
- Git references;
- context digests;
- lineage.

That work requires a separate storage/privacy contract.

## 22. Failure semantics

### 22.1 Daemon absent

The adapter reports observation delivery as unavailable and continues harness execution.

Existing Pi-local context injection/certification behavior must remain available where possible.

### 22.2 Daemon slow

Adapter-to-daemon delivery must not introduce unbounded provider-path latency.

The implementation should prefer bounded/asynchronous delivery where the harness contract permits it.

### 22.3 Invalid event

The daemon rejects the event with a typed/protocol error.

It does not silently coerce unknown schema into a different meaning.

### 22.4 Sequence gap

The stream is marked incomplete until the gap is resolved or explicitly accepted as lost evidence.

Later events may still be visible.

### 22.5 Duplicate event

The same event ID is idempotent and does not produce duplicate projected state.

### 22.6 Hachidori unavailable

Classification remains pending/unavailable.

No agent execution or dashboard base functionality is blocked.

### 22.7 Dashboard unavailable

Observation ingestion remains independent of browser availability.

## 23. Security and privacy

Default security posture:

- ingestion endpoint is local-only;
- dashboard binds to loopback only;
- no public network listener;
- no remote hosted telemetry;
- no raw context display by default;
- no raw transcript persistence by default.

A local dashboard still exposes sensitive development metadata.

Future remote exposure must add an explicit authentication and transport-security design rather than simply changing the bind address to `0.0.0.0`.

## 24. Package and repository boundaries

The exact directory structure is implementation-time detail, but the intended responsibility split is:

```text
src/
  protocol/
    observation events / validation

  daemon/
    admission
    projection
    local transport
    dashboard server

  dashboard/
    static HTML/CSS/JS projection

  adapters/
    pi/
      Pi hooks
      Pi -> Yokodori event translation

  compiler/
  core/
  sdk/
```

The daemon/protocol/dashboard must not import Pi packages.

Pi remains isolated under its adapter boundary.

## 25. Public/package surface

The current public SDK exports remain valid.

The daemon requires an executable launch surface.

Possible forms include:

```text
yokodori daemon
```

or an equivalent narrow package executable.

Wave 0 chooses the concrete package shape.

The executable must not turn every internal daemon operation into a public CLI contract.

The first CLI responsibility is process launch/discovery/status, not product authority.

## 26. Relationship to Tsukai

Tsukai remains the AgentRun lifecycle authority.

If Tsukai is integrated later:

```text
Tsukai AgentRun ID
      |
      v
Yokodori stream externalRun reference
```

Yokodori does not duplicate or synthesize Tsukai lifecycle semantics.

A Yokodori stream can exist without Tsukai, which keeps direct Pi use simple.

## 27. Relationship to Jinushi

Jinushi owns physical process execution.

Yokodori daemon should not become a process supervisor merely because it is resident.

A future deployment may ask Jinushi/systemd/user services to supervise Yokodori, but this is composition, not ownership transfer.

## 28. Relationship to Nawabari and Git

Nawabari/Git retain workspace and mutation authority.

Yokodori consumes read-only facts for display and semantic correlation.

Checkpoint commits are useful semantic anchors, but automatic checkpoint commit creation requires a separately accepted mutation path.

## 29. Relationship to Hachidori

Hachidori performs typed semantic inference.

Yokodori owns:

- what classifiers are requested;
- how results attach to observation events;
- how classifiers contribute to semantic projection;
- how confidence/provenance is displayed.

Hachidori owns the classification execution contract.

The daemon should be useful when Hachidori is absent.

## 30. Wave plan

### Wave 0 — daemon and dashboard foundation

Issue #25.

Deliver:

- daemon process;
- canonical protocol;
- local discovery;
- multi-stream in-memory projection;
- Pi evidence bridge;
- Git observation shape;
- loopback dashboard;
- live context/certification timeline;
- explicit extension seams for checkpoints/classification/lineage.

Do not implement fake semantic tags merely to fill the UI.

### Wave 1 — semantic execution trail

Expected scope:

- `message.observed`;
- agent checkpoint declaration path;
- checkpoint/Git commit correlation;
- Hachidori multi-axis classifiers;
- asynchronous classification queue;
- timeline tags;
- confidence/provenance display.

### Wave 2 — lineage and adapter generalization

Expected scope:

- explicit fork/child relationships;
- execution graph UI;
- stream navigation;
- proof with at least one non-Pi adapter or adapter-neutral fixture;
- parent/child checkpoint correlation.

### Wave 3 — bounded durable semantic history

Expected scope only after privacy/storage design:

- durable checkpoint metadata;
- semantic classifications;
- Git references;
- lineage;
- query/recovery;
- bounded retention.

Raw transcript persistence is not implied.

## 31. Wave 0 architectural postcondition

After Wave 0, the following must work:

```text
Pi package
   |
   | compile/inject/observe/certify as today
   |
   +--> bounded canonical events
             |
             v
       Yokodori daemon
             |
             +--> stream A
             +--> stream B
             |
             v
       loopback dashboard
```

A user can open one dashboard and see:

- connected streams;
- repository/branch/HEAD information when observed;
- current context digest/source count;
- injection state;
- request observation state;
- exact certification result;
- chronological bounded events.

Checkpoint, classification, and lineage surfaces are structurally ready but do not claim data that Wave 0 does not yet produce.

## 32. Architecture invariants

1. The daemon is independent from Pi.
2. Pi is the first adapter, not the canonical protocol.
3. Adapter failure to reach the daemon cannot become provider-request authority.
4. Context injection remains adapter-local unless future authority explicitly moves it.
5. One daemon can represent multiple observation streams.
6. A Yokodori stream is not automatically a Tsukai AgentRun.
7. External facts retain provenance.
8. Checkpoints are explicit declarations, not inferred commits.
9. Message classifications are probabilistic inferences, not facts.
10. Hachidori classification is asynchronous.
11. Git observation is read-only evidence.
12. The dashboard is read-only first.
13. The primary UI is the execution timeline, not daemon infrastructure.
14. Raw model-visible context is not persisted or exposed by default.
15. Cross-host federation and SSH/tunnel automation are deferred.
16. The event schema is more durable than its transport.
17. Multi-stream/fork topology is modeled without making Yokodori the fork executor.
18. The daemon remains useful without Tsukai, Hachidori, or a browser.
19. The dashboard remains useful without semantic classifications.
20. New adapters must not force Pi-specific concepts into Core/protocol.
