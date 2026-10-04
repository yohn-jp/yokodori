# Yokodori

Deterministic initial-context compilation and passive Pi context-boundary observation. Node.js 22+; TypeScript SDK, no CLI.

npm: https://www.npmjs.com/package/yokodori

## Install as a Pi package

Install Yokodori from Pi:

```bash
pi install npm:yokodori
```

Pi discovers the extension from the package's `pi.extensions` manifest. In an interactive Pi session, enter `/yokodori {"task":{"id":"task-1","kind":"task","content":"Your admitted task text"}}` before the first request. The argument is a JSON `InitialContextInput` (see the `yokodori` SDK type); the user owns admission of every source. The extension compiles it and appends it through `before_agent_start` for subsequent requests. Before admission, it does not intervene. Enter `/yokodori` without arguments to see the latest bounded certification evidence: request sequence, `pi.context_with_system` boundary, completeness, transcript digest, compiled digest, and whether the exact compiled text occurs in the observed system section. Pi wraps prompt sections, so this certifies exact payload inclusion, not equality of entire system prompts or provider-effective equivalence. Reconfiguration in the same session is rejected. No raw observed transcript is stored, printed, or transmitted by default. This uses Pi's package loader and command API; no user-created `DefaultResourceLoader` or private configuration file is needed.

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
