// Thin wrapper around EventSource for the shared inbox (CRM Phase 3). Falls
// back silently to nothing beyond the caller's own periodic refetch if the
// stream errors twice — the inbox is designed to still work via polling
// (see CrmInbox.jsx), SSE only makes it feel live. See CLAUDE.md CRM plan §6.

import { useEffect, useRef } from "react";
import { inbox } from "@/api/inboxClient";

// events: array of event names to listen for, e.g. ["message.created", "lock.claimed"]
// onEvent: (eventName, payload) => void
export function useCrmEvents(events, onEvent) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let es;
    let errorCount = 0;
    try {
      es = new EventSource(inbox.streamUrl());
    } catch {
      return;
    }
    const listeners = events.map((name) => {
      const fn = (ev) => {
        errorCount = 0;
        try {
          handlerRef.current(name, JSON.parse(ev.data));
        } catch {
          // ignore malformed payloads
        }
      };
      es.addEventListener(name, fn);
      return [name, fn];
    });
    es.onerror = () => {
      errorCount += 1;
      if (errorCount >= 2) es.close();
    };
    return () => {
      listeners.forEach(([name, fn]) => es.removeEventListener(name, fn));
      es.close();
    };
  }, [events.join(',')]);
}
