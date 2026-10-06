import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseObservationEvent, type ObservationEventV1 } from '../protocol/observation.js';
import type { Classification } from '../protocol/classification.js';
import { createClassificationScheduler } from './classification-scheduler.js';

// Oldest streams and events are evicted first. Evicted event IDs cannot be retried idempotently.
export const MAX_STREAMS = 32;
export const MAX_EVENTS = 64;
export const MAX_STREAM_MESSAGES = 64;
export const MAX_STREAM_MESSAGE_BYTES = 128 * 1024;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
type MessageEvent = Extract<ObservationEventV1, { kind: 'message.observed' }>;
type Stream = {
  streamId: string; sequence: number; closed: boolean; events: ObservationEventV1[];
  latest: Partial<Record<ObservationEventV1['kind'], ObservationEventV1>>;
  messages: MessageEvent[]; classifications: Map<string, Classification>; retainedMessageBytes: number; evictedMessageCount: number;
  evictedMessageBytes: number; truncatedMessageCount: number;
};
const textBytes = (text: string) => Buffer.byteLength(text, 'utf8');
const observedMessageBytes = (event: MessageEvent) => event.payload.originalBytes ?? textBytes(event.payload.text);

function projectMessageHistory(stream: Stream) {
  return {
    retainedCount: stream.messages.length,
    retainedBytes: stream.retainedMessageBytes,
    evictedCount: stream.evictedMessageCount,
    evictedBytes: stream.evictedMessageBytes,
    truncatedCount: stream.truncatedMessageCount,
    incomplete: stream.evictedMessageCount > 0 || stream.truncatedMessageCount > 0,
  };
}

function projectStream(stream: Stream) {
  const { messages, classifications, retainedMessageBytes, evictedMessageCount, evictedMessageBytes, truncatedMessageCount, ...base } = stream;
  return {
    ...base,
    messages: messages.map(event => ({ sequence: event.sequence, observedAt: event.observedAt, ...event.payload })),
    classifications: [...classifications.values()],
    messageHistory: projectMessageHistory(stream),
  };
}
export function createDaemon() {
  const streams = new Map<string, Stream>();
  const clients = new Set<ServerResponse>();
  const scheduler = createClassificationScheduler();
  const notify = () => { for (const client of clients) if (!client.write('event: update\ndata: {}\n\n')) { client.end(); clients.delete(client); } };
  const snapshot = () => ({ streams: [...streams.values()].map(projectStream) });
  const send = (res: ServerResponse, code: number, value: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value));
  };
  const error = (res: ServerResponse, code: number, reason: string) => send(res, code, { error: reason });
  const body = async (req: IncomingMessage): Promise<unknown> => {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
    let data = '';
    for await (const chunk of req) { data += String(chunk); if (Buffer.byteLength(data) > MAX_REQUEST_BODY_BYTES) throw new Error('BODY_TOO_LARGE'); }
    return JSON.parse(data) as unknown;
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'" });
        return res.end(await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url))));
      }
      if (req.method === 'GET' && path === '/dashboard.css') {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(fileURLToPath(new URL('../dashboard/dashboard.css', import.meta.url))));
      }
      if (req.method === 'GET' && path === '/dashboard.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(fileURLToPath(new URL('../dashboard/dashboard.js', import.meta.url))));
      }
      if (req.method === 'GET' && path === '/api/v1/live') {
        if (clients.size >= 32) return error(res, 503, 'TOO_MANY_CLIENTS');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n'); clients.add(res); res.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && path === '/api/v1/snapshot') return send(res, 200, snapshot());
      if (req.method === 'GET' && path === '/api/v1/streams') return send(res, 200, [...streams.values()].map(stream => ({
        streamId: stream.streamId, sequence: stream.sequence, closed: stream.closed, latest: stream.latest,
        messageHistory: projectMessageHistory(stream),
      })));
      if (req.method === 'GET' && path === '/api/v1/events') return send(res, 200, [...streams.values()].flatMap(s => s.events));
      const match = /^\/api\/v1\/streams\/([^/]+)(\/events)?$/.exec(path);
      if (req.method === 'GET' && match && !match[2]) {
        const stream = streams.get(decodeURIComponent(match[1]!)); return stream ? send(res, 200, projectStream(stream)) : error(res, 404, 'STREAM_NOT_FOUND');
      }
      if (req.method === 'POST' && path === '/api/v1/streams') {
        const v = await body(req);
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || !('streamId' in v) || typeof v.streamId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v.streamId)) return error(res, 400, 'INVALID_STREAM');
        if (streams.has(v.streamId)) return send(res, 200, { streamId: v.streamId });
        if (streams.size >= MAX_STREAMS) streams.delete(streams.keys().next().value!);
        streams.set(v.streamId, { streamId: v.streamId, sequence: 0, closed: false, events: [], latest: {},
          messages: [], classifications: new Map(), retainedMessageBytes: 0, evictedMessageCount: 0, evictedMessageBytes: 0, truncatedMessageCount: 0 });
        return send(res, 201, { streamId: v.streamId });
      }
      if (req.method === 'POST' && match?.[2]) {
        const id = decodeURIComponent(match[1]!);
        const stream = streams.get(id);
        if (!stream) return error(res, 404, 'STREAM_NOT_FOUND');
        const event = parseObservationEvent(await body(req));
        if (event.streamId !== id) return error(res, 409, 'STREAM_MISMATCH');
        const duplicate = stream.events.find(e => e.eventId === event.eventId);
        if (duplicate) return JSON.stringify(duplicate) === JSON.stringify(event) ? send(res, 200, { accepted: true, duplicate: true }) : error(res, 409, 'EVENT_ID_CONFLICT');
        if (stream.closed) return error(res, 409, 'STREAM_CLOSED');
        // Gaps are rejected; no absent observation is invented.
        if (event.sequence !== stream.sequence + 1) return error(res, 409, 'SEQUENCE_CONFLICT');
        if (stream.sequence === 0 && event.kind !== 'stream.opened') return error(res, 409, 'OPEN_REQUIRED');
        stream.sequence = event.sequence; stream.closed = event.kind === 'stream.closed';
        stream.events.push(event); if (stream.events.length > MAX_EVENTS) stream.events.shift();
        stream.latest[event.kind] = event as never;
        if (event.kind === 'message.observed') {
          stream.messages.push(event);
          stream.retainedMessageBytes += textBytes(event.payload.text);
          if (event.payload.truncated) stream.truncatedMessageCount++;
          while (stream.messages.length > MAX_STREAM_MESSAGES || stream.retainedMessageBytes > MAX_STREAM_MESSAGE_BYTES) {
            const evicted = stream.messages.shift()!;
            stream.classifications.delete(evicted.eventId);
            const bytes = textBytes(evicted.payload.text);
            stream.retainedMessageBytes -= bytes;
            stream.evictedMessageCount++;
            stream.evictedMessageBytes = Math.min(Number.MAX_SAFE_INTEGER, stream.evictedMessageBytes + observedMessageBytes(evicted));
            const retainedEventIndex = stream.events.indexOf(evicted);
            if (retainedEventIndex !== -1) stream.events.splice(retainedEventIndex, 1);
          }
        }
        notify();
        send(res, 201, { accepted: true, duplicate: false });
        if (event.kind === 'message.observed' && stream.messages.includes(event)) {
          scheduler.schedule({ eventId: event.eventId, sequence: event.sequence, observedAt: event.observedAt,
            role: event.payload.role, text: event.payload.text,
            retained: () => streams.get(id) === stream && stream.messages.includes(event),
            update: value => { stream.classifications.set(event.eventId, value); notify(); } });
        }
        return;
      }
      return error(res, 404, 'NOT_FOUND');
    } catch (e) { return error(res, 400, e instanceof Error && /^(UNSUPPORTED_VERSION|INVALID_EVENT|INVALID_PAYLOAD|INVALID_CONTENT_TYPE|BODY_TOO_LARGE)$/.test(e.message) ? e.message : 'INVALID_JSON'); }
  });
  return { server, listen: async () => {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Invalid listener');
    return `http://127.0.0.1:${address.port}`;
  }, close: async () => { await scheduler.close(); for (const client of clients) client.end(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}
