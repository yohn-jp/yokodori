# Yokodori

Deterministic initial context and passive Pi context-boundary observation. Node.js 22+; TypeScript SDK, no CLI.

npm: https://www.npmjs.com/package/yokodori

```bash
npm install yokodori@0.1.0
```

```ts
import { createYokodori } from 'yokodori';
import { createPiExtension } from 'yokodori/pi';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const runtime = createYokodori({
  observer: { onOutboundContext: async (snapshot) => {
    // Host-owned handling of sensitive data. Nothing is stored or logged by Yokodori.
  } },
});
const attachment = await createPiExtension({
  runtime,
  initialContext: async () => ({ task: { id: 'issue-1', kind: 'task', content: 'Implement the boundary.' } }),
  injection: 'append', // default; 'control' observes only, 'replace' is experimental
  certification: 'strict',
});
// Pass { name: 'yokodori', factory: attachment.extension } in
// DefaultResourceLoader({ ..., extensionFactories: [...] }), then reload the loader
// and bind the host-owned Pi session's extensions before prompting.
// attachment.status() exposes observer failures; strict failures invalidate certification.
```

`createPiExtension` is asynchronous so compilation fails **before** the host starts the affected session/request. Prepare a new attachment when semantic inputs change. No Pi lifecycle or credential management is performed here.

The snapshot is the transcript visible at `pi.context_with_system`. Pi applies its forced-system-prompt projection *after* this hook in replace mode; those snapshots report `providerEffective: false` and `knownPostBoundaryProjection: 'forced-system-prompt'`. Control and append also conservatively report `providerEffective: false`: Pi may perform other request projections after the hook; fixture-level provider equivalence does not establish a universal runtime guarantee. Digest and statistics identify captured boundary content, excluding Pi message timestamps and snapshot sequence. Other Pi/provider conversions are not a Yokodori Core contract.

The canonical initial renderer is version 1; all hashes are SHA-256 of UTF-8 bytes, lowercase hex. Changing renderer output requires a version change. Source `digest` is optional caller metadata and is not a replacement for content in the canonical output.

Run `npm run verify` for build, import/export boundary checks and deterministic Pi integration tests.
