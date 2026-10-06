import { Buffer } from 'node:buffer';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MAX_MESSAGE_TEXT_BYTES, type ObservationEventV1 } from '../../protocol/observation.js';
import { snapshot } from '../../core/outbound.js';
import { digest } from '../../language/canonical.js';
import { instructionFile, loadInstructions } from './instruct.js';
import { createBridge } from './bridge.js';
import { observeGit } from './git-observation.js';

type Status = { state: 'unconfigured' | 'ready' | 'observed' | 'configuration_failure' | 'certification_failure';
  instructionFile: string; sourceCount?: number; compiledDigest?: string; requestSequence?: number;
  boundary?: string; complete?: boolean; observedInjectedDigest?: string; matched?: boolean; failure?: string;
  omittedFieldCount?: number; omittedFields?: string[]; bridge?: ReturnType<ReturnType<typeof createBridge>['status']> };
type MessagePayload = Extract<ObservationEventV1, { kind: 'message.observed' }>['payload'];

function utf8Prefix(value: string, maxBytes: number): { text: string; bytes: number } {
  let bytes = 0;
  let text = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    text += character;
    bytes += characterBytes;
  }
  return { text, bytes };
}

function messagePayload(message: unknown): MessagePayload | undefined {
  if (message === null || typeof message !== 'object') return undefined;
  const candidate = message as { role?: unknown; content?: unknown };
  if (candidate.role !== 'user' && candidate.role !== 'assistant') return undefined;
  const content = typeof candidate.content === 'string' ? [{ type: 'text', text: candidate.content }]
    : Array.isArray(candidate.content) ? candidate.content : undefined;
  if (!content) return undefined;
  let originalBytes = 0;
  let retainedBytes = 0;
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object' || !('type' in block) || block.type !== 'text' ||
      !('text' in block) || typeof block.text !== 'string' || block.text.length === 0) continue;
    const text = block.text;
    if (parts.length > 0) {
      originalBytes++;
      if (retainedBytes < MAX_MESSAGE_TEXT_BYTES) { parts.push('\n'); retainedBytes++; }
    }
    originalBytes += Buffer.byteLength(text, 'utf8');
    const prefix = utf8Prefix(text, MAX_MESSAGE_TEXT_BYTES - retainedBytes);
    if (prefix.text) parts.push(prefix.text);
    retainedBytes += prefix.bytes;
  }
  if (retainedBytes === 0) return undefined;
  const truncated = originalBytes > retainedBytes;
  return { role: candidate.role, text: parts.join(''), truncated, ...(truncated ? { originalBytes } : {}) };
}

/** Pi package entrypoint: prepare once per session, before the first ordinary request. */
export default function yokodoriPackageExtension(pi: ExtensionAPI): void {
  let status: Status = { state: 'unconfigured', instructionFile };
  let compiled: Awaited<ReturnType<typeof loadInstructions>>;
  let sequence = 0;
  let bridge = createBridge();
  pi.on('session_start', async (_event, ctx) => {
    bridge = createBridge();
    bridge.emit({ kind: 'stream.opened', payload: {} });
    const sessionBridge = bridge;
    void observeGit(ctx.cwd).then(git => { if (git) sessionBridge.emit({ kind: 'git.observed', payload: git }); }).catch(() => {});
    sequence = 0;
    compiled = undefined;
    status = { state: 'unconfigured', instructionFile };
    try {
      compiled = await loadInstructions(ctx.cwd);
      if (compiled) {
        status = { state: 'ready', instructionFile, sourceCount: compiled.sourceCount, compiledDigest: compiled.compiled.digest };
        bridge.emit({ kind: 'context.compiled', payload: { digest: compiled.compiled.digest, sourceCount: compiled.sourceCount, rendererVersion: compiled.compiled.rendererVersion } });
      }
    } catch {
      status = { state: 'configuration_failure', instructionFile, failure: 'Invalid or unreadable manifest/source' };
      ctx.ui.notify(JSON.stringify(status), 'error');
    }
  });
  pi.on('before_agent_start', event => {
    if (compiled) {
      event.systemPromptOptions.sections['yokodori_initial_context'] = compiled.compiled.text;
      bridge.emit({ kind: 'context.injected', payload: { state: 'injected', boundary: 'before_agent_start' } });
    }
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
      const matched = observedInjectedDigest !== undefined && observedInjectedDigest === compiled.compiled.digest;
      const omittedFields = observed.messages.flatMap(message => message.omittedFields).slice(0, 16);
      const omittedFieldCount = observed.messages.reduce((sum, message) => sum + message.omittedFieldCount, 0);
      status = { state: matched ? 'observed' : 'certification_failure', ...base, complete: observed.complete,
        ...(observedInjectedDigest ? { observedInjectedDigest } : {}), matched,
        ...(omittedFieldCount ? { omittedFieldCount, omittedFields } : {}),
        ...(!matched ? { failure: observedInjectedDigest === undefined ? 'Observed injected section missing' : 'Observed injected digest mismatch' } : {}) };
    } catch {
      status = { state: 'certification_failure', ...base, complete: false, matched: false, failure: 'Observation failed' };
    }
    bridge.emit({ kind: 'context.observed', completeness: status.complete ? 'complete' : 'partial',
      payload: { requestSequence: current, boundary: 'pi.context_with_system', complete: status.complete ?? false,
        ...(status.observedInjectedDigest ? { observedDigest: status.observedInjectedDigest } : {}),
        ...(status.omittedFieldCount ? { omittedFieldCount: status.omittedFieldCount, omittedFields: status.omittedFields } : {}),
        certification: status.matched ? 'MATCH' : 'MISMATCH' } });
    // Notification only; observation never changes the provider request.
  });
  pi.on('message_end', event => {
    const payload = messagePayload(event.message);
    if (payload) bridge.emit({ kind: 'message.observed', completeness: payload.truncated ? 'partial' : 'complete', payload });
  });
  pi.on('session_shutdown', () => { bridge.emit({ kind: 'stream.closed', payload: {} }); });
  pi.registerCommand('yokodori', {
    description: 'Show bounded Yokodori instruction and observation status',
    handler: async (args, ctx) => {
      if (args.trim() && args.trim() !== 'status') { ctx.ui.notify('Usage: /yokodori [status]', 'error'); return; }
      const report = { ...status, bridge: bridge.status() };
      ctx.ui.notify(JSON.stringify(report), status.state.endsWith('failure') ? 'error' : 'info');
    },
  });
}
