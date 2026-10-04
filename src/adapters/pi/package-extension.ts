import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { snapshot } from '../../core/outbound.js';
import { digest } from '../../language/canonical.js';
import { instructionFile, loadInstructions } from './instruct.js';

type Status = { state: 'unconfigured' | 'ready' | 'observed' | 'configuration_failure' | 'certification_failure';
  instructionFile: string; sourceCount?: number; compiledDigest?: string; requestSequence?: number;
  boundary?: string; complete?: boolean; observedInjectedDigest?: string; matched?: boolean; failure?: string };

/** Pi package entrypoint: prepare once per session, before the first ordinary request. */
export default function yokodoriPackageExtension(pi: ExtensionAPI): void {
  let status: Status = { state: 'unconfigured', instructionFile };
  let compiled: Awaited<ReturnType<typeof loadInstructions>>;
  let sequence = 0;
  pi.on('session_start', async (_event, ctx) => {
    sequence = 0;
    compiled = undefined;
    status = { state: 'unconfigured', instructionFile };
    try {
      compiled = await loadInstructions(ctx.cwd);
      if (compiled) status = { state: 'ready', instructionFile, sourceCount: compiled.sourceCount, compiledDigest: compiled.compiled.digest };
    } catch {
      status = { state: 'configuration_failure', instructionFile, failure: 'Invalid or unreadable manifest/source' };
      ctx.ui.notify(JSON.stringify(status), 'error');
    }
  });
  pi.on('before_agent_start', event => {
    if (compiled) event.systemPromptOptions.sections['yokodori_initial_context'] = compiled.compiled.text;
  });
  pi.on('context_with_system', event => {
    if (!compiled) return;
    const current = ++sequence;
    const base = { instructionFile, sourceCount: compiled.sourceCount, compiledDigest: compiled.compiled.digest,
      requestSequence: current, boundary: 'pi.context_with_system' };
    try {
      const observed = snapshot(event.messages, current, { boundary: 'pi.context_with_system', providerEffective: false });
      const sections = observed.messages.filter(message => message.role === 'system').map(message => message.payload)
        .filter(payload => payload !== null && typeof payload === 'object' && !Array.isArray(payload))
        .map(payload => (payload as Readonly<Record<string, unknown>>).sections)
        .filter(value => value !== null && typeof value === 'object' && !Array.isArray(value))
        .map(value => (value as Readonly<Record<string, unknown>>).yokodori_initial_context);
      // Pi wraps each prompt section in a named XML-like element. Extract its body,
      // never search for the expected compiled text within an arbitrary transcript.
      const prefix = '<yokodori_initial_context>\n';
      const suffix = '\n</yokodori_initial_context>';
      const section = sections.length === 1 && typeof sections[0] === 'string' ? sections[0] : undefined;
      const text = section?.startsWith(prefix) && section.endsWith(suffix)
        ? section.slice(prefix.length, -suffix.length) : undefined;
      const observedInjectedDigest = text === undefined ? undefined : digest(text);
      const matched = observed.complete && observedInjectedDigest === compiled.compiled.digest;
      status = { state: matched ? 'observed' : 'certification_failure', ...base, complete: observed.complete,
        ...(observedInjectedDigest ? { observedInjectedDigest } : {}), matched,
        ...(!matched ? { failure: 'Observed section missing, incomplete, or digest mismatch' } : {}) };
    } catch {
      status = { state: 'certification_failure', ...base, complete: false, matched: false, failure: 'Observation failed' };
    }
    // Notification only; observation never changes the provider request.
  });
  pi.registerCommand('yokodori', {
    description: 'Show bounded Yokodori instruction and observation status',
    handler: async (args, ctx) => {
      if (args.trim() && args.trim() !== 'status') { ctx.ui.notify('Usage: /yokodori [status]', 'error'); return; }
      ctx.ui.notify(JSON.stringify(status), status.state.endsWith('failure') ? 'error' : 'info');
    },
  });
}
