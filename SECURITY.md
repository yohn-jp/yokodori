# Security Policy

## Supported versions

Security fixes target `main` and the latest published 0.x release. Yokodori does not currently maintain long-term-support branches.

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub Security Advisories rather than a public Issue.

Include the affected version or commit, impact, and a minimal safe reproduction where possible. Do not include credentials, private keys, authorization headers, tokens, raw model-visible context, private repository content, or other sensitive material in public evidence.

If private reporting is unavailable, open an Issue containing only nonsensitive information and ask a maintainer to establish a private channel.

## Security boundary

Yokodori handles model-visible context, which may contain sensitive repository, task, tool, or conversation data. Raw snapshots are not logged, persisted, or transmitted by default. Persistence and analysis belong to an explicitly injected host observer.

Yokodori does not own provider credentials or provider transport. The Pi adapter uses supported extension boundaries and must not intercept provider transport or modify Pi Core to claim stronger observation fidelity.

Snapshot fidelity describes the boundary actually observed. A digest of an observed transcript must not be presented as proof of an unobserved downstream provider payload.

Observer failure does not grant Yokodori authority to cancel provider execution. Strict certification marks the observation incomplete or uncertifiable while Pi retains execution authority.

## Disclosure

Please allow maintainers reasonable time to investigate and prepare a fix before public disclosure. Security reports are handled on a best-effort basis by an independently maintained project.
