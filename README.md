# Yokodori

Deterministic initial-context compilation and passive Pi context-boundary observation. Node.js 22+; TypeScript SDK, no CLI.

npm: https://www.npmjs.com/package/yokodori

## Install as a Pi package

Install Yokodori from Pi:

```bash
pi install npm:yokodori
```

Pi discovers the extension from the package's `pi.extensions` manifest. In the project root, create `.yokodori/instruct.json` before opening a Pi session:

```json
{"version":1,"context":[{"path":"AGENTS.md","kind":"instructions","rank":100},{"path":"README.md","kind":"repository","rank":200}]}
```

The manifest explicitly admits repository-relative UTF-8 text files. Paths and ranks must be unique; ranks are non-negative integers and determine model-visible source order, regardless of array order. No globs or implicit discovery are supported. The package reads and compiles these files once at session start, appends the frozen context through `before_agent_start` on the first ordinary request, and observes the injected section at `context_with_system`. An absent manifest leaves the package unconfigured; invalid manifests report configuration failure. `/yokodori` or `/yokodori status` displays bounded state and independently calculated observed-section digest equality without revealing source contents or the raw transcript. This certifies the Pi observation boundary, not provider-effective equivalence. No command or user-created `DefaultResourceLoader` is required before the first request.

The package integration is tested with `@earendil-works/pi-coding-agent` 1.0.0, which requires Node.js 22.19 or newer. Yokodori retains its Node.js `>=22` engine floor for SDK compatibility. The Pi host package is an optional peer dependency: Pi supplies its own runtime, and SDK-only installs do not pull in a separate Pi runtime.

## Install as an SDK dependency

For use as a TypeScript/JavaScript library in an application:

```bash
npm install yokodori@0.1.1
```

The existing public imports remain:

```ts
import { createYokodori } from 'yokodori';
import { createPiExtension } from 'yokodori/pi';
```

The SDK can compile initial context and observe Pi's `context_with_system` boundary. A host that wants a configured SDK attachment can continue to supply its own runtime and options to `createPiExtension`:

```ts
const runtime = createYokodori({
  observer: { onOutboundContext: async snapshot => {
    // Optional host-owned handling. Yokodori does not store or log snapshots.
  } },
});
const attachment = await createPiExtension({
  runtime,
  injection: 'control',
});
// Attach attachment.extension through the host's existing Pi integration.
```

`createPiExtension` returns an extension factory for a host's existing Pi integration. Direct Pi package installation is separate and does not require this manual setup.

The snapshot represents the transcript exposed at `pi.context_with_system`, not necessarily the provider-effective transcript. Pi applies its forced-system-prompt projection after this hook in `replace` mode; those snapshots report `providerEffective: false` and `knownPostBoundaryProjection: 'forced-system-prompt'`. Other Pi/provider conversions are not a Yokodori Core contract.

The canonical initial renderer is version 1; all hashes are SHA-256 of UTF-8 bytes, lowercase hex. Changing renderer output requires a version change. Source `digest` is optional caller metadata and is not a replacement for content in the canonical output.

## Local observation dashboard (Wave 0)

With Node.js 22 or later, run `yokodori daemon` (or `node dist/daemon/cli.js daemon` from a source build). The daemon prints its selected `http://127.0.0.1:<port>/` dashboard URL. It writes a metadata-only endpoint descriptor at `~/.cache/yokodori/endpoint.json`; set `YOKODORI_RUNTIME_DIR` for a different local descriptor directory, consistently in the daemon and Pi processes. Open the printed URL in a browser. Run the daemon before starting a Pi session to collect its complete bounded event sequence. Without the daemon, Pi injection, certification, and `/yokodori` still work; missing events are not replayed.

The single loopback HTTP service provides `POST /api/v1/streams` with `{ "streamId": "..." }`, `POST /api/v1/streams/{streamId}/events` with a validated `ObservationEventV1`, and `GET /api/v1/streams`, `GET /api/v1/streams/{streamId}`, `GET /api/v1/events`, `GET /api/v1/snapshot`, `GET /api/v1/live` (SSE), `GET /health`, and `GET /`. Stream events start at sequence 1 with `stream.opened` and advance by exactly one; gaps and stale/out-of-order events are rejected with `SEQUENCE_CONFLICT`. Identical retained event IDs are idempotent; contradictory retries are rejected. There is no missing-event reconstruction. The daemon retains at most 32 streams and 64 timeline events per stream, evicting oldest first; an evicted ID is no longer deduplicable, but its old sequence remains rejected. Current latest event by kind is retained within each stream. The dashboard reloads the snapshot after SSE reconnect; SSE does not replay history. A failed adapter delivery disables that session's bridge (at most eight outstanding operations, each HTTP request timed out at 400 ms) without affecting provider requests.

The Pi extension observes finalized messages at Pi's supported `message_end` hook. It emits only user and assistant text blocks; system messages, thinking blocks, tool results, and images are excluded. Each message is limited to 8 KiB of UTF-8 text. The daemon retains at most 64 messages and 128 KiB of text per stream, evicting oldest messages first. Stream and snapshot reads include retained `messages` in envelope sequence order and `messageHistory` with retained, evicted, and truncated counts/bytes plus an `incomplete` flag. Raw message text exists only in daemon memory and disappears when the daemon stops; system prompts and raw model context are never captured as conversation. The daemon is in-memory only and has no remote bind or control API.

Run `npm run verify` for build, import/export boundary checks, and deterministic Pi integration tests.
