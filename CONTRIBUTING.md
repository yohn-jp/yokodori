# Contributing to Yokodori

Contributions are welcome through GitHub Issues and pull requests.

## Start with the contract

Read `AGENTS.md`, the organization governance contract, `docs/ARCHITECTURE.md`, and the accepted Issue or Epic governing the work.

Yokodori has a deliberately narrow authority boundary. Do not move workspace, process, AgentRun, orchestration, provider credential, or provider transport ownership into Yokodori as an incidental implementation convenience.

## Development

Use the documented Node.js toolchain and strict TypeScript. Work from current `main` on an isolated branch or worktree and preserve unrelated work.

Run focused tests while developing, then run:

```bash
npm run verify
```

Do not weaken deterministic fixtures, import boundaries, fidelity reporting, or observer-failure behavior merely to make a change pass.

## Pull requests

Keep pull requests bounded to their governing Issue. State the behavior delivered and the verification actually performed. Distinguish local verification from CI and live-provider dogfood.

Do not merge, force-push, tag, publish npm packages, or change repository settings without explicit authority.

## Documentation

Update documentation when public behavior, architecture, installation, compatibility, or security semantics change. Do not describe target architecture as implemented behavior without executable evidence.

## Security

Follow [SECURITY.md](./SECURITY.md). Never place secrets or sensitive raw model-visible context in Issues, pull requests, logs, fixtures, or retained public evidence.
