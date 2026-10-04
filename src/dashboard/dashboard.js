const stream = document.getElementById('stream');
const show = value => value === undefined ? 'unknown' : String(value);
async function refresh() {
  try {
    const response = await fetch('/api/v1/snapshot');
    if (!response.ok) return;
    const { streams } = await response.json();
    const selected = stream.value;
    stream.replaceChildren();
    for (const item of streams) { const option = document.createElement('option'); option.value = item.streamId; option.textContent = item.streamId; stream.append(option); }
    if (streams.some(item => item.streamId === selected)) stream.value = selected;
    const current = streams.find(item => item.streamId === stream.value);
    const set = (id, ...values) => { document.getElementById(id).textContent = values.map(show).join(' · '); };
    const git = current?.latest['git.observed']?.payload;
    set('repo', git?.root ?? 'No Git observation yet', git?.branch, git?.head?.slice(0, 12), git?.dirty);
    set('current', current?.streamId ?? 'Awaiting stream', current?.latest['stream.opened']?.source.adapter, current?.latest['context.observed']?.payload.requestSequence && `request #${current.latest['context.observed'].payload.requestSequence}`, current?.closed ? 'closed' : 'open');
    const compiled = current?.latest['context.compiled']?.payload;
    const observed = current?.latest['context.observed']?.payload;
    set('context', compiled ? `${compiled.sourceCount} sources · digest ${compiled.digest.slice(0, 12)}…` : 'Not compiled', current?.latest['context.injected'] ? 'injected' : 'not injected', observed ? `${observed.certification} · ${observed.complete ? 'complete' : 'incomplete'}` : 'not observed');
    const timeline = document.getElementById('timeline'); timeline.replaceChildren();
    for (const event of current?.events ?? []) { const row = document.createElement('li'); row.textContent = `${event.observedAt} · ${event.kind} · #${event.sequence}${event.kind === 'context.observed' ? ` · ${event.payload.certification}` : ''}`; timeline.append(row); }
  } catch { document.getElementById('current').textContent = 'Observation unavailable'; }
}
stream.addEventListener('change', refresh);
const live = new EventSource('/api/v1/live');
live.addEventListener('update', refresh);
live.addEventListener('open', refresh);
refresh();
