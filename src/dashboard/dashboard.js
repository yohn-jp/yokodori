// Read-only projection of the daemon snapshot. No inference or semantic vocabulary lives here.
const streamsView = document.getElementById('streams');
const searchInput = document.getElementById('execution-search');
const filterButtons = {
  all: document.getElementById('filter-all'),
  running: document.getElementById('filter-running'),
  finished: document.getElementById('filter-finished'),
};
const viewTabs = {
  conversation: document.getElementById('tab-conversation'),
  timeline: document.getElementById('tab-timeline'),
  git: document.getElementById('tab-git'),
};
const viewPanels = {
  conversation: document.getElementById('view-conversation'),
  timeline: document.getElementById('view-timeline'),
  git: document.getElementById('view-git'),
};

let selectedStreamId = null;
let selectedMessageSequence = null;
let activeView = 'conversation';
let executionFilter = 'all';
let searchQuery = '';
let snapshot = { streams: [] };
let refreshVersion = 0;

function text(parent, tag, className, value) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = String(value);
  parent.append(node);
  return node;
}

function detailRow(parent, label, value) {
  if (value === undefined || value === null || value === '') return;
  const row = document.createElement('div');
  row.className = 'detail-row';
  text(row, 'span', 'detail-label', label);
  text(row, 'span', 'detail-value', value);
  parent.append(row);
}

function statusRow(parent, label, value, tone) {
  const row = document.createElement('div');
  row.className = 'status-row';
  text(row, 'span', 'status-label', label);
  text(row, 'span', 'status-value ' + tone, value);
  parent.append(row);
}

function metric(parent, value, label, wide) {
  const node = document.createElement('div');
  node.className = 'metric' + (wide ? ' metric-wide' : '');
  text(node, 'strong', 'metric-value', value);
  text(node, 'span', 'metric-label', label);
  parent.append(node);
}

function rootLabel(root, fallback) {
  if (typeof root !== 'string' || !root) return fallback;
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || root;
}

function formatTime(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function shortId(value) {
  if (typeof value !== 'string') return '';
  return value.length > 18 ? value.slice(0, 16) + '…' : value;
}

function currentStream() {
  return snapshot.streams.find(function (item) { return item.streamId === selectedStreamId; });
}

function classificationFor(stream, message) {
  return (stream && stream.classifications ? stream.classifications : []).find(function (item) {
    return item.sourceSequence === message.sequence;
  });
}

function percent(value) {
  return Math.round(value * 100) + '%';
}

function streamState(stream) {
  return stream.closed ? 'finished' : 'running';
}

function gitFor(stream) {
  return stream && stream.latest ? stream.latest['git.observed'] && stream.latest['git.observed'].payload : undefined;
}

function lastObservedAt(stream) {
  const eventTime = stream && stream.events && stream.events.length ? stream.events.at(-1).observedAt : undefined;
  const messageTime = stream && stream.messages && stream.messages.length ? stream.messages.at(-1).observedAt : undefined;
  return eventTime || messageTime || (stream && stream.latest && stream.latest['stream.opened'] ? stream.latest['stream.opened'].observedAt : undefined);
}

function matchesStream(stream) {
  const state = streamState(stream);
  if (executionFilter !== 'all' && state !== executionFilter) return false;
  if (!searchQuery) return true;
  const git = gitFor(stream);
  const haystack = [stream.streamId, git && git.root, git && git.branch, rootLabel(git && git.root, '')]
    .filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(searchQuery);
}

function visibleStreams() {
  return snapshot.streams.filter(matchesStream);
}

function ensureVisibleSelection() {
  const visible = visibleStreams();
  if (visible.some(function (item) { return item.streamId === selectedStreamId; })) return;
  selectedStreamId = visible[0] ? visible[0].streamId : null;
  selectedMessageSequence = null;
}

function renderFilterCounts() {
  const running = snapshot.streams.filter(function (item) { return !item.closed; }).length;
  const finished = snapshot.streams.length - running;
  document.getElementById('count-all').textContent = snapshot.streams.length;
  document.getElementById('count-running').textContent = running;
  document.getElementById('count-finished').textContent = finished;
  Object.entries(filterButtons).forEach(function (entry) {
    entry[1].setAttribute('aria-pressed', String(entry[0] === executionFilter));
  });
}

function renderStreams() {
  streamsView.replaceChildren();
  renderFilterCounts();
  const visible = visibleStreams();
  if (!visible.length) {
    text(streamsView, 'p', 'execution-empty', snapshot.streams.length ? 'No executions match this view.' : 'No executions observed yet.');
    return;
  }

  visible.forEach(function (item) {
    const git = gitFor(item);
    const state = streamState(item);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'execution-item';
    button.setAttribute('aria-current', item.streamId === selectedStreamId ? 'true' : 'false');
    if (git && git.root) button.setAttribute('title', git.root);

    const top = document.createElement('span');
    top.className = 'execution-topline';
    text(top, 'strong', 'execution-name', rootLabel(git && git.root, shortId(item.streamId)));
    text(top, 'span', 'mini-state ' + state, state === 'running' ? 'Running' : 'Finished');
    button.append(top);

    const sub = document.createElement('span');
    sub.className = 'execution-subline';
    text(sub, 'span', 'execution-branch', git && git.branch ? git.branch : 'branch unavailable');
    button.append(sub);

    const foot = document.createElement('span');
    foot.className = 'execution-foot';
    text(foot, 'span', 'execution-stream', shortId(item.streamId));
    const last = formatTime(lastObservedAt(item));
    if (last) text(foot, 'time', '', last);
    button.append(foot);

    button.addEventListener('click', function () {
      if (selectedStreamId === item.streamId) return;
      selectedStreamId = item.streamId;
      selectedMessageSequence = null;
      render();
    });
    streamsView.append(button);
  });
}

function renderExecutionHeader(stream) {
  const title = document.getElementById('execution-title');
  const status = document.getElementById('execution-status');
  const meta = document.getElementById('execution-meta');
  const current = document.getElementById('current');
  meta.replaceChildren();

  if (!stream) {
    title.textContent = 'Awaiting stream';
    status.textContent = 'Waiting';
    status.className = 'state-badge state-neutral';
    text(meta, 'span', 'meta-item', snapshot.streams.length ? 'No execution matches the current filter.' : 'Conversation and observation evidence');
    current.textContent = 'Awaiting stream';
    return;
  }

  const git = gitFor(stream);
  const state = streamState(stream);
  title.textContent = rootLabel(git && git.root, stream.streamId);
  status.textContent = state === 'running' ? 'Running' : 'Finished';
  status.className = 'state-badge ' + (state === 'running' ? 'state-running' : 'state-finished');

  if (git && git.branch) text(meta, 'span', 'meta-item', git.branch);
  text(meta, 'span', 'meta-item', 'Session ' + shortId(stream.streamId));
  const started = stream.latest && stream.latest['stream.opened'] ? formatTime(stream.latest['stream.opened'].observedAt) : undefined;
  const latest = formatTime(lastObservedAt(stream));
  if (started) text(meta, 'span', 'meta-item', 'Started ' + started);
  if (latest) text(meta, 'span', 'meta-item', 'Last observed ' + latest);
  current.textContent = stream.streamId + ' · ' + state;
}

function renderViewState() {
  Object.keys(viewTabs).forEach(function (name) {
    viewTabs[name].setAttribute('aria-selected', String(name === activeView));
    viewPanels[name].hidden = name !== activeView;
  });
}

function renderConversation(stream) {
  const conversation = document.getElementById('conversation');
  conversation.replaceChildren();
  const messages = stream && stream.messages ? stream.messages : [];
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    text(empty, 'strong', '', 'No retained conversation observations yet');
    text(empty, 'span', '', 'Messages appear here when the harness emits bounded conversation evidence.');
    conversation.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'message-list';
  list.setAttribute('aria-label', 'Observed conversation messages');

  messages.forEach(function (message) {
    const annotation = classificationFor(stream, message);
    const item = document.createElement('li');
    item.className = 'message-card';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-select message-' + message.role;
    button.setAttribute('aria-pressed', String(selectedMessageSequence === message.sequence));
    button.setAttribute('aria-label', message.role + ' message #' + message.sequence);

    const shell = document.createElement('span');
    shell.className = 'message-shell';

    const header = document.createElement('span');
    header.className = 'message-head';
    text(header, 'strong', 'message-role', message.role === 'user' ? 'User' : 'Assistant');
    const observed = formatTime(message.observedAt);
    if (observed) {
      const time = text(header, 'time', 'message-meta', observed);
      time.dateTime = message.observedAt;
    }
    text(header, 'span', 'message-meta', '#' + message.sequence);
    shell.append(header);

    text(shell, 'span', 'message-text', message.text);

    if (message.truncated || message.originalBytes !== undefined) {
      const size = message.originalBytes === undefined ? '' : ' · ' + message.originalBytes + ' bytes';
      text(shell, 'span', 'message-details', (message.truncated ? 'Truncated' : 'Original size') + size);
    }

    const chips = document.createElement('span');
    chips.className = 'message-annotations';
    if (annotation && annotation.status === 'complete') {
      (annotation.axes || []).forEach(function (axis) {
        if (axis.choice === undefined) return;
        const low = axis.confidence !== undefined && axis.confidence < 0.5;
        const label = axis.id + ': ' + axis.choice + (axis.confidence === undefined ? '' : ' ' + percent(axis.confidence));
        const chip = text(chips, 'span', 'axis-chip' + (low ? ' low-emphasis' : ''), label);
        if (axis.confidence !== undefined) chip.title = 'Hachidori confidence ' + percent(axis.confidence);
      });
    } else {
      const statusText = annotation ? annotation.status : 'not classified';
      text(chips, 'span', 'classification-state ' + (annotation ? annotation.status : ''), 'Classification ' + statusText);
    }
    shell.append(chips);
    button.append(shell);

    button.addEventListener('click', function () {
      selectedMessageSequence = message.sequence;
      renderConversation(currentStream());
      renderInspector(currentStream());
    });

    item.append(button);
    list.append(item);
  });

  conversation.append(list);
}

function renderTimeline(stream) {
  const timeline = document.getElementById('timeline');
  timeline.replaceChildren();
  const events = stream && stream.events ? stream.events : [];
  if (!events.length) {
    text(timeline, 'li', 'timeline-empty', 'No source observations retained.');
    return;
  }
  events.forEach(function (event) {
    const row = document.createElement('li');
    row.className = 'timeline-row';
    text(row, 'span', 'timeline-sequence', '#' + event.sequence);
    text(row, 'strong', 'timeline-kind', event.kind);
    let detail = '';
    if (event.kind === 'context.observed' && event.payload) {
      detail = event.payload.certification + ' · ' + (event.payload.complete ? 'complete' : 'partial');
    } else if (event.kind === 'git.observed' && event.payload) {
      detail = [event.payload.branch, event.payload.dirty].filter(Boolean).join(' · ');
    }
    text(row, 'span', 'timeline-detail', detail);
    text(row, 'time', 'timeline-time', formatTime(event.observedAt) || '');
    timeline.append(row);
  });
}

function renderGit(stream) {
  const pane = document.getElementById('repo');
  pane.replaceChildren();
  const git = gitFor(stream);
  if (!git) {
    const empty = document.createElement('div');
    empty.className = 'git-empty';
    text(empty, 'strong', '', 'No Git observation');
    text(empty, 'span', '', 'Git facts appear here when the adapter reports them.');
    pane.append(empty);
    return;
  }
  [
    ['Root', git.root],
    ['Branch', git.branch],
    ['HEAD', git.head],
    ['Working tree', git.dirty],
  ].forEach(function (entry) {
    if (entry[1] === undefined || entry[1] === null) return;
    const row = document.createElement('div');
    row.className = 'git-row';
    text(row, 'span', 'git-label', entry[0]);
    text(row, 'span', 'git-value', entry[1]);
    pane.append(row);
  });
}

function renderContext(stream) {
  const pane = document.getElementById('context');
  pane.replaceChildren();
  const compiled = stream && stream.latest ? stream.latest['context.compiled'] && stream.latest['context.compiled'].payload : undefined;
  const injected = stream && stream.latest ? stream.latest['context.injected'] : undefined;
  const observed = stream && stream.latest ? stream.latest['context.observed'] && stream.latest['context.observed'].payload : undefined;

  statusRow(pane, 'Compiled', compiled ? (compiled.sourceCount + ' sources') : 'Not observed', compiled ? 'ok' : 'neutral');
  statusRow(pane, 'Injected', injected ? 'Observed' : 'Not observed', injected ? 'ok' : 'neutral');
  statusRow(pane, 'Observed', observed ? (observed.complete ? 'Complete' : 'Partial') : 'Not observed', observed ? (observed.complete ? 'ok' : 'warn') : 'neutral');
  statusRow(pane, 'Certification', observed ? observed.certification : 'Not observed',
    observed ? (observed.certification === 'MATCH' ? 'ok' : 'danger') : 'neutral');
}

function renderRetention(stream) {
  const pane = document.getElementById('retention');
  pane.replaceChildren();
  const history = stream && stream.messageHistory;
  if (!history) {
    metric(pane, '—', 'No retention evidence', true);
    return;
  }
  metric(pane, history.retainedCount, 'Retained');
  metric(pane, history.evictedCount, 'Evicted');
  metric(pane, history.truncatedCount, 'Truncated');
  if (history.retainedBytes !== undefined) metric(pane, history.retainedBytes + ' B', 'Retained bytes');
  metric(pane, history.incomplete ? 'Incomplete' : 'Complete', 'History', true);
}

function renderClassificationState(pane, result) {
  const block = document.createElement('div');
  const status = result ? result.status : 'unavailable';
  block.className = 'classification-state-block ' + status;
  text(block, 'strong', '', result ? result.status : 'No classification observation');
  const reason = result && result.failure ? result.failure : (result ? 'No inferred choices are available for this message.' : 'No Hachidori annotation has been observed for this message.');
  text(block, 'p', '', reason);
  pane.append(block);
}

function renderInspector(stream) {
  const pane = document.getElementById('message-inspector');
  const evidence = document.getElementById('execution-evidence');
  pane.replaceChildren();

  const message = stream && stream.messages ? stream.messages.find(function (item) {
    return item.sequence === selectedMessageSequence;
  }) : undefined;

  evidence.open = !message;

  if (!stream) {
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    text(empty, 'p', 'eyebrow', 'Inspector');
    text(empty, 'strong', '', 'No execution selected');
    text(empty, 'p', 'muted', 'Choose an execution to inspect observation health.');
    pane.append(empty);
    return;
  }

  if (!message) {
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    text(empty, 'p', 'eyebrow', 'Execution');
    text(empty, 'strong', '', 'Observation health');
    text(empty, 'p', 'muted', 'Select a message to inspect its Hachidori annotation.');
    pane.append(empty);
    return;
  }

  text(pane, 'p', 'eyebrow', 'Message #' + message.sequence + ' · ' + message.role);
  text(pane, 'h2', '', 'Hachidori classification');
  text(pane, 'p', 'muted', 'Probabilistic semantic observation · not execution fact');

  const result = classificationFor(stream, message);
  if (!result || result.status !== 'complete') {
    renderClassificationState(pane, result);
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'classification-summary';
  detailRow(summary, 'Status', 'Complete');
  detailRow(summary, 'Profile', result.profile ? result.profile.id + '@' + result.profile.version : undefined);
  detailRow(summary, 'Model', result.classifier && result.classifier.model);
  detailRow(summary, 'Provider', result.classifier && result.classifier.provider);
  detailRow(summary, 'Inference', result.timing && result.timing.inferenceMs !== undefined ? result.timing.inferenceMs + ' ms' : undefined);
  detailRow(summary, 'Total', result.timing && result.timing.totalMs !== undefined ? result.timing.totalMs + ' ms' : undefined);
  detailRow(summary, 'Source', '#' + result.sourceSequence + ' · ' + result.sourceEventId);
  pane.append(summary);

  if (!result.axes || !result.axes.length) return;
  text(pane, 'h3', 'axis-heading', 'Axes');
  result.axes.forEach(function (axis) {
    if (axis.choice === undefined) return;
    const section = document.createElement('section');
    section.className = 'axis-detail';
    const heading = document.createElement('div');
    heading.className = 'axis-heading-row';
    text(heading, 'strong', '', axis.id);
    text(heading, 'span', 'axis-choice', axis.choice);
    if (axis.confidence !== undefined) text(heading, 'span', 'axis-confidence', percent(axis.confidence));
    section.append(heading);

    if (axis.probabilities) {
      Object.entries(axis.probabilities).forEach(function (entry) {
        const row = document.createElement('div');
        row.className = 'probability-row';
        text(row, 'span', '', entry[0]);
        const meter = document.createElement('meter');
        meter.min = 0;
        meter.max = 1;
        meter.value = entry[1];
        meter.setAttribute('aria-label', axis.id + ': ' + entry[0] + ' probability');
        row.append(meter);
        text(row, 'span', '', percent(entry[1]));
        section.append(row);
      });
    }
    pane.append(section);
  });
}

function render() {
  ensureVisibleSelection();
  const stream = currentStream();
  renderStreams();
  renderExecutionHeader(stream);
  renderViewState();
  renderConversation(stream);
  renderTimeline(stream);
  renderGit(stream);
  renderContext(stream);
  renderRetention(stream);
  renderInspector(stream);
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const response = await fetch('/api/v1/snapshot');
    if (!response.ok) return;
    const next = await response.json();
    if (version !== refreshVersion) return;
    snapshot = next;
    ensureVisibleSelection();
    const stream = currentStream();
    if (!stream || !(stream.messages || []).some(function (item) { return item.sequence === selectedMessageSequence; })) {
      selectedMessageSequence = null;
    }
    render();
  } catch {
    document.getElementById('current').textContent = 'Observation unavailable';
  }
}

searchInput.addEventListener('input', function (event) {
  searchQuery = String(event.target.value || '').trim().toLowerCase();
  ensureVisibleSelection();
  render();
});

Object.entries(filterButtons).forEach(function (entry) {
  entry[1].addEventListener('click', function () {
    executionFilter = entry[0];
    ensureVisibleSelection();
    render();
  });
});

Object.entries(viewTabs).forEach(function (entry) {
  entry[1].addEventListener('click', function () {
    activeView = entry[0];
    renderViewState();
  });
});

const live = new EventSource('/api/v1/live');
live.addEventListener('update', refresh);
live.addEventListener('open', refresh);
refresh();
