// Read-only projection of the daemon snapshot. No inference or semantic vocabulary lives here.
const streamsView = document.getElementById('streams');
let selectedStreamId = null;
let selectedMessageSequence = null;
let snapshot = { streams: [] };
let refreshVersion = 0;

function text(parent, tag, className, value) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = String(value);
  parent.append(node);
  return node;
}
function field(parent, label, value) {
  if (value === undefined || value === null) return;
  const row = document.createElement('div');
  row.className = 'detail-row';
  text(row, 'span', 'detail-label', label);
  text(row, 'span', 'detail-value', value);
  parent.append(row);
}
const currentStream = () => snapshot.streams.find(item => item.streamId === selectedStreamId);
const classificationFor = (stream, message) => (stream.classifications ?? []).find(item => item.sourceSequence === message.sequence);
const percent = value => `${Math.round(value * 100)}%`;

function renderStreams() {
  streamsView.replaceChildren();
  if (!snapshot.streams.length) {
    text(streamsView, 'p', 'muted', 'No executions observed yet.');
    return;
  }
  for (const item of snapshot.streams) {
    const git = item.latest?.['git.observed']?.payload;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'execution-item';
    button.setAttribute('aria-current', item.streamId === selectedStreamId ? 'true' : 'false');
    text(button, 'strong', 'execution-name', git?.root ?? item.streamId);
    text(button, 'span', 'execution-branch', [git?.branch, item.closed ? 'closed' : 'open'].filter(Boolean).join(' · '));
    if (git?.root) text(button, 'span', 'execution-id', item.streamId);
    const last = item.events?.at(-1)?.observedAt;
    if (last) text(button, 'time', 'execution-time', last);
    button.addEventListener('click', () => {
      if (selectedStreamId !== item.streamId) {
        selectedStreamId = item.streamId;
        selectedMessageSequence = null;
        render();
        streamsView.children[snapshot.streams.findIndex(stream => stream.streamId === item.streamId)]?.focus?.();
      }
    });
    streamsView.append(button);
  }
}

function renderConversation(stream) {
  const conversation = document.getElementById('conversation');
  conversation.replaceChildren();
  const messages = stream?.messages ?? [];
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    text(empty, 'strong', '', 'No retained conversation observations yet');
    text(empty, 'p', 'muted', 'User and assistant messages appear here when observed.');
    conversation.append(empty);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'message-list';
  list.setAttribute('aria-label', 'Observed conversation messages');
  for (const message of messages) {
    const annotation = classificationFor(stream, message);
    const item = document.createElement('li');
    item.className = 'message-card';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `message-select message-${message.role}`;
    button.setAttribute('aria-pressed', String(selectedMessageSequence === message.sequence));
    button.setAttribute('aria-label', `${message.role} message #${message.sequence}`);
    const header = document.createElement('span');
    header.className = 'message-head';
    text(header, 'strong', 'message-role', message.role === 'user' ? 'User' : 'Assistant');
    if (message.observedAt) {
      const time = text(header, 'time', 'message-meta', message.observedAt);
      time.dateTime = message.observedAt;
    }
    text(header, 'span', 'message-meta', `#${message.sequence}`);
    button.append(header);
    text(button, 'span', 'message-text', message.text);
    if (message.truncated || message.originalBytes !== undefined) {
      text(button, 'span', 'message-details', `${message.truncated ? 'Truncated' : 'Original size'}${message.originalBytes === undefined ? '' : ` · ${message.originalBytes} bytes`}`);
    }
    const chips = document.createElement('span');
    chips.className = 'message-annotations';
    if (annotation?.status === 'complete') {
      for (const axis of annotation.axes) {
        if (axis.choice === undefined) continue;
        const chip = text(chips, 'span', `axis-chip${axis.confidence !== undefined && axis.confidence < .5 ? ' low-emphasis' : ''}`, `${axis.id}: ${axis.choice}`);
        if (axis.confidence !== undefined) chip.title = `Hachidori confidence ${percent(axis.confidence)}`;
      }
    } else {
      text(chips, 'span', 'classification-state', annotation ? `Classification ${annotation.status}` : 'No classification observation');
    }
    button.append(chips);
    button.addEventListener('click', () => {
      selectedMessageSequence = message.sequence;
      render();
      const index = currentStream()?.messages?.findIndex(item => item.sequence === message.sequence);
      if (index !== undefined && index >= 0) document.getElementById('conversation').children[0]?.children[index]?.children[0]?.focus?.();
    });
    item.append(button); list.append(item);
  }
  conversation.append(list);
}

function renderMessageInspector(stream) {
  const pane = document.getElementById('message-inspector');
  pane.replaceChildren();
  const message = stream?.messages?.find(item => item.sequence === selectedMessageSequence);
  if (!message) {
    text(pane, 'p', 'eyebrow', 'Execution detail');
    text(pane, 'h2', '', stream ? 'Select a message' : 'No execution selected');
    text(pane, 'p', 'muted', stream ? 'Select a retained message to inspect its Hachidori annotation. Repository and context evidence remain below.' : 'Waiting for observation streams.');
    return;
  }
  text(pane, 'p', 'eyebrow', `Message #${message.sequence} · ${message.role}`);
  text(pane, 'h2', '', 'Classification');
  text(pane, 'p', 'muted', 'Probabilistic Hachidori observation · not execution fact');
  const result = classificationFor(stream, message);
  if (!result) {
    text(pane, 'p', 'classification-state', 'No classification observation');
    return;
  }
  const details = document.createElement('div');
  details.className = 'classification-details';
  field(details, 'Status', result.status);
  field(details, 'Profile', result.profile ? `${result.profile.id}@${result.profile.version}` : undefined);
  field(details, 'Source', `#${result.sourceSequence} · ${result.sourceEventId}`);
  field(details, 'Observed', result.observedAt);
  field(details, 'Completed', result.completedAt);
  field(details, 'Model', result.classifier?.model);
  field(details, 'Provider', result.classifier?.provider);
  field(details, 'Inference', result.timing?.inferenceMs === undefined ? undefined : `${result.timing.inferenceMs} ms`);
  field(details, 'Total', result.timing?.totalMs === undefined ? undefined : `${result.timing.totalMs} ms`);
  field(details, 'Failure', result.failure);
  pane.append(details);
  if (result.status !== 'complete') text(pane, 'p', 'classification-state', `Classification ${result.status} · no inferred choices`);
  if (!result.axes?.length) return;
  text(pane, 'h3', 'axis-heading', 'Axes');
  for (const axis of result.axes) {
    const section = document.createElement('section');
    section.className = 'axis-detail';
    const heading = document.createElement('div');
    heading.className = 'axis-heading-row';
    text(heading, 'strong', '', axis.id);
    if (result.status === 'complete' && axis.choice !== undefined) {
      text(heading, 'span', 'axis-choice', axis.choice);
      if (axis.confidence !== undefined) text(heading, 'span', 'axis-confidence', percent(axis.confidence));
    } else text(heading, 'span', 'muted', 'No choice');
    section.append(heading);
    if (result.status === 'complete' && axis.probabilities) {
      for (const [choice, probability] of Object.entries(axis.probabilities)) {
        const row = document.createElement('div');
        row.className = 'probability-row';
        text(row, 'span', '', choice);
        const meter = document.createElement('meter');
        meter.min = 0; meter.max = 1; meter.value = probability;
        meter.setAttribute('aria-label', `${axis.id}: ${choice} probability`);
        row.append(meter);
        text(row, 'span', '', percent(probability));
        section.append(row);
      }
    }
    pane.append(section);
  }
}

function render() {
  const current = currentStream();
  renderStreams();
  const git = current?.latest?.['git.observed']?.payload;
  document.getElementById('execution-title').textContent = git?.root ?? current?.streamId ?? 'Awaiting stream';
  document.getElementById('execution-meta').textContent = [git?.branch, current?.streamId, current ? (current.closed ? 'closed' : 'open') : undefined].filter(Boolean).join(' · ') || 'Conversation and observation evidence';
  document.getElementById('current').textContent = current ? `${current.streamId} · ${current.closed ? 'closed' : 'open'}` : 'Awaiting stream';
  document.getElementById('repo').textContent = [git?.root ?? 'No Git observation yet', git?.branch, git?.head?.slice(0, 12), git?.dirty].filter(value => value !== undefined).join(' · ');
  const compiled = current?.latest?.['context.compiled']?.payload;
  const injected = current?.latest?.['context.injected'];
  const observed = current?.latest?.['context.observed']?.payload;
  document.getElementById('context').textContent = [compiled ? `${compiled.sourceCount} sources · digest ${compiled.digest.slice(0, 12)}…` : 'Not compiled',
    injected ? 'injected' : 'not injected', observed ? `${observed.certification} · ${observed.complete ? 'complete' : 'incomplete'}` : 'not observed'].join(' · ');
  const history = current?.messageHistory;
  document.getElementById('retention').textContent = history ? `${history.retainedCount} retained · ${history.evictedCount} evicted${history.incomplete ? ' · incomplete history' : ' · complete retained history'}${history.truncatedCount ? ` · ${history.truncatedCount} truncated` : ''}` : 'No retained messages';
  const timeline = document.getElementById('timeline');
  timeline.replaceChildren();
  for (const event of current?.events ?? []) {
    text(timeline, 'li', '', `${event.observedAt} · ${event.kind} · #${event.sequence}${event.kind === 'context.observed' ? ` · ${event.payload.certification}` : ''}`);
  }
  renderConversation(current);
  renderMessageInspector(current);
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const response = await fetch('/api/v1/snapshot');
    if (!response.ok) return;
    const next = await response.json();
    if (version !== refreshVersion) return;
    snapshot = next;
    if (!snapshot.streams.some(item => item.streamId === selectedStreamId)) {
      selectedStreamId = snapshot.streams[0]?.streamId ?? null;
      selectedMessageSequence = null;
    }
    if (!currentStream()?.messages?.some(item => item.sequence === selectedMessageSequence)) selectedMessageSequence = null;
    render();
  } catch {
    document.getElementById('current').textContent = 'Observation unavailable';
  }
}

const live = new EventSource('/api/v1/live');
live.addEventListener('update', refresh);
live.addEventListener('open', refresh);
refresh();
