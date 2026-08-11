// Server-Sent Events hub for the shared inbox. Everything that wants to push
// a live update (a new message, a lock taken/released, a conversation
// status change) calls publish() — nothing writes to a response stream
// directly. Swapping the transport later (e.g. WebSocket) means rewriting
// only this file; see CLAUDE.md CRM plan §6.
//
// In-process only (matches scheduledReports/crm jobs' single-process
// assumption) — fine for this deployment's agent count, and correctness
// never depends on it: locking is DB-authoritative, SSE only makes the UI
// feel live.

const subscribers = new Set(); // { res, username }

function subscribe(res, { username }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  const sub = { res, username };
  subscribers.add(sub);

  const keepAlive = setInterval(() => {
    try { res.write(':ping\n\n'); } catch (_) { /* connection likely already gone */ }
  }, 25000);

  res.on('close', () => {
    clearInterval(keepAlive);
    subscribers.delete(sub);
  });
}

// event: string, payload: any. Broadcasts to every connected agent — the
// inbox has no per-user filtering need (any agent may see any conversation).
function publish(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const sub of subscribers) {
    try { sub.res.write(data); } catch (_) { subscribers.delete(sub); }
  }
}

module.exports = { subscribe, publish };
