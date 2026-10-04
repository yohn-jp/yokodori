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

The package integration is tested with `@earendil-works/pi-coding-agent` 1.0.2, which requires Node.js 22.19 or newer. Yokodori retains its Node.js `>=22` engine floor for SDK compatibility. The Pi host package is an optional peer dependency: Pi supplies its own runtime, and SDK-only installs do not pull in a separate Pi runtime.

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

Run `npm run verify` for build, import/export boundary checks, and deterministic Pi integration tests.
