const stream = document.getElementById('stream');
const show = value => value === undefined ? 'unknown' : String(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function textElement(parent, tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function isMessageObservation(event) {
  const payload = event?.payload;
  return event?.kind === 'message.observed' && isRecord(payload) &&
    (payload.role === 'user' || payload.role === 'assistant') &&
    typeof payload.text === 'string' && typeof payload.truncated === 'boolean' &&
    (payload.originalBytes === undefined || (Number.isSafeInteger(payload.originalBytes) && payload.originalBytes >= 0));
}

function renderConversation(events) {
  const conversation = document.getElementById('conversation');
  conversation.replaceChildren();
  const messages = (events ?? []).filter(isMessageObservation);
  if (messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    const copy = document.createElement('div');
    textElement(copy, 'strong', '', 'No retained conversation observations yet');
    const detail = document.createElement('div');
    detail.append(document.createTextNode('User and assistant messages will appear here when '));
    textElement(detail, 'code', '', 'message.observed');
    detail.append(document.createTextNode(' is available.'));
    copy.append(detail);
    empty.append(copy);
    conversation.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'message-list';
  list.setAttribute('aria-label', 'Observed conversation messages');
  for (const event of messages) {
    const payload = event.payload;
    const item = document.createElement('li');
    item.className = `message-card message-${payload.role}`;
    const header = document.createElement('div');
    header.className = 'message-head';
    textElement(header, 'strong', 'message-role', payload.role === 'user' ? 'User' : 'Assistant');
    const time = document.createElement('time');
    time.className = 'message-meta';
    time.dateTime = event.observedAt;
    time.textContent = event.observedAt;
    header.append(time);
    textElement(header, 'span', 'message-meta', `#${event.sequence}`);
    item.append(header);
    textElement(item, 'p', 'message-text', payload.text);
    if (payload.truncated || payload.originalBytes !== undefined) {
      const details = payload.truncated ? 'Truncated' : 'Original size';
      const bytes = payload.originalBytes === undefined ? '' : ` · ${payload.originalBytes} bytes`;
      textElement(item, 'p', 'message-details', `${details}${bytes}`);
    }
    list.append(item);
  }
  conversation.append(list);
}

async function refresh() {
  try {
    const response = await fetch('/api/v1/snapshot');
    if (!response.ok) return;
    const { streams } = await response.json();
    const selected = stream.value;
    stream.replaceChildren();
    for (const item of streams) {
      const option = document.createElement('option');
      option.value = item.streamId;
      option.textContent = item.streamId;
      stream.append(option);
    }
    if (streams.some(item => item.streamId === selected)) stream.value = selected;
    const current = streams.find(item => item.streamId === stream.value);
    const set = (id, ...values) => {
      document.getElementById(id).textContent = values.map(show).join(' · ');
    };
    const git = current?.latest?.['git.observed']?.payload;
    set('repo', git?.root ?? 'No Git observation yet', git?.branch, git?.head?.slice(0, 12), git?.dirty);
    const contextObserved = current?.latest?.['context.observed']?.payload;
    set('current', current?.streamId ?? 'Awaiting stream', current?.latest?.['stream.opened']?.source?.adapter,
      contextObserved?.requestSequence === undefined ? undefined : `request #${contextObserved.requestSequence}`,
      current ? (current.closed ? 'closed' : 'open') : undefined);
    const compiled = current?.latest?.['context.compiled']?.payload;
    const injected = current?.latest?.['context.injected'];
    const context = current?.latest?.['context.observed']?.payload;
    set('context', compiled ? `${compiled.sourceCount} sources · digest ${compiled.digest.slice(0, 12)}…` : 'Not compiled',
      injected ? 'injected' : 'not injected',
      context ? `${context.certification} · ${context.complete ? 'complete' : 'incomplete'}` : 'not observed');

    const timeline = document.getElementById('timeline');
    timeline.replaceChildren();
    for (const event of current?.events ?? []) {
      const row = document.createElement('li');
      const detail = event.kind === 'context.observed' ? ` · ${event.payload.certification}` : '';
      row.textContent = `${event.observedAt} · ${event.kind} · #${event.sequence}${detail}`;
      timeline.append(row);
    }
    renderConversation(current?.events);
  } catch {
    document.getElementById('current').textContent = 'Observation unavailable';
  }
}

stream.addEventListener('change', refresh);
const live = new EventSource('/api/v1/live');
live.addEventListener('update', refresh);
live.addEventListener('open', refresh);
refresh();
