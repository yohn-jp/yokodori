# Yokodori

Read `.github/agent-governance/AGENTS.md` and the applicable organization Skill before work.

Yokodori owns the model-visible context compiled for an agent. It does not own repository/workspace truth, process execution, AgentRun lifecycle, orchestration policy, or provider credentials.

## Authority

1. Latest explicit product-owner instruction.
2. Accepted Issue / Implementation scope.
3. `docs/ARCHITECTURE.md`, then the applicable accepted Epic.
4. Public types, validators, tests, and current supported Pi contracts as executable evidence.
5. This file and applicable organization governance.

Do not reinterpret a settled product boundary. If implementation conflicts with an authority, report the smallest concrete contradiction instead of silently changing architecture.

## Ownership invariants

- Yokodori owns canonical model-facing context compilation, context projection semantics, and observation of supported model-context boundaries.
- Raw history is evidence; it is not automatically effective model context.
- Repository, Issue, workspace, runtime, and other external facts remain owned by their source authorities. Yokodori compiles them without becoming their source of truth.
- Pi is an adapter/harness integration, not Yokodori Core.
- Pi-specific imports belong only under `src/adapters/pi/**`.
- Provider transport interception, Pi Core modification, and invented unobserved transcripts are not acceptable substitutes for supported integration boundaries.
- Raw model-visible context is sensitive. Do not persist, print, or transmit it by default.
- Determinism claims require byte-level evidence. Do not describe semantically similar output as byte-identical without proof.

## Implementation

Use strict TypeScript. Preserve narrow public exports: `yokodori` and `yokodori/pi`.

Keep Core, compiler, language, and vocabulary independent of Pi. Do not add speculative adapters, daemons, CLIs, semantic compression, probes, metacognition, forks, or orchestration features without accepted scope.

## Git and verification

Work on task branches/worktrees; do not implement directly on `main` unless explicitly authorized. Do not merge, tag, publish, or change repository settings without explicit authority.

Full repository verification: `npm run verify`.

Distinguish local verification, CI, packed-consumer verification, live-provider dogfood, merge, tag, GitHub Release, and npm publication. None implies the others.
