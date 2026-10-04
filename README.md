# Yokodori

Deterministic initial-context compilation and passive Pi context-boundary observation. Node.js 22+; TypeScript SDK, no CLI.

npm: https://www.npmjs.com/package/yokodori

## Install as a Pi package

After version 0.1.1 is published, install Yokodori from Pi:

```bash
pi install npm:yokodori@0.1.1
```

Pi discovers the extension from the package's `pi.extensions` manifest. The packaged extension attaches Yokodori in passive `control` mode: it does not inject or rewrite provider-bound context, and does not persist, print, or transmit observed context. It uses Pi's own extension loader; no user-created `DefaultResourceLoader` is needed.

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
