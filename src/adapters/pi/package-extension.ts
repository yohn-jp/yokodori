import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { InitialContextInput, OutboundContextSnapshot } from '../../core/context.js';
import { digest } from '../../language/canonical.js';
import { createYokodori } from '../../sdk/index.js';
import { createPiExtension } from './index.js';

/** Package input is supplied by Pi's command argument, not a package settings file. */
export default function yokodoriPackageExtension(pi: ExtensionAPI): void {
  let configured = false;
  let evidence: { requestSequence: number; boundary: string; complete: boolean; snapshotDigest: string; compiledDigest: string; represented: boolean; failure?: string } | undefined;
  pi.registerCommand('yokodori', {
    description: 'Admit initial context as JSON; without arguments show bounded observation evidence',
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify(JSON.stringify(evidence ?? { state: configured ? 'awaiting observation' : 'unconfigured' }), 'info');
        return;
      }
      if (configured) { ctx.ui.notify('Yokodori already configured for this session', 'error'); return; }
      try {
        const input: InitialContextInput = JSON.parse(args) as InitialContextInput;
        const runtime = createYokodori({ observer: { onOutboundContext: (observed: OutboundContextSnapshot) => {
          const system = observed.messages.filter(message => message.role === 'system');
          const represented = observed.complete && system.some(message => {
            const payload = message.payload;
            if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
            const fields = payload as Readonly<Record<string, unknown>>;
            const sections = fields.sections;
            if (sections !== null && typeof sections === 'object' && !Array.isArray(sections)) {
              const section = (sections as Readonly<Record<string, unknown>>).yokodori_initial_context;
              if (typeof section === 'string' && section.includes(compiled.text)) return true;
            }
            const content = fields.content;
            return (typeof content === 'string' && content.includes(compiled.text)) || (Array.isArray(content) && content.some((part: unknown) =>
              part !== null && typeof part === 'object' && !Array.isArray(part)
              && 'type' in part && part.type === 'text' && 'text' in part
              && typeof part.text === 'string' && part.text.includes(compiled.text)));
          });
          evidence = { requestSequence: observed.requestSequence, boundary: observed.fidelity.boundary,
            complete: observed.complete, snapshotDigest: observed.digest, compiledDigest: compiled.digest, represented,
            ...(!represented ? { failure: 'compiled payload not represented in complete system message' } : {}) };
          ctx.ui.notify(JSON.stringify(evidence), represented ? 'info' : 'error');
        } } });
        const compiled = runtime.compile(input);
        const attachment = await createPiExtension({ runtime, initialContext: () => input, injection: 'append', certification: 'strict',
          onObservationFailure: failure => {
            evidence = { requestSequence: failure.requestSequence, boundary: 'pi.context_with_system', complete: false,
              snapshotDigest: '', compiledDigest: compiled.digest, represented: false, failure: 'observation failed' };
            ctx.ui.notify(JSON.stringify(evidence), 'error');
          } });
        attachment.extension(pi);
        configured = true;
        ctx.ui.notify(JSON.stringify({ state: 'configured', compiledDigest: digest(compiled.text) }), 'info');
      } catch {
        ctx.ui.notify('Invalid Yokodori initial context or Pi attachment; no context admitted', 'error');
      }
    },
  });
}
