import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const LiveEventsContext = createContext(null);

export function LiveEventsProvider({ children, url = "/api/events", enabled = true }) {
  const listeners = useRef(new Set());
  const [connection, setConnection] = useState(enabled ? "connecting" : "disabled");
  const subscribe = useCallback((listener) => { listeners.current.add(listener); return () => listeners.current.delete(listener); }, []);
  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") { setConnection(enabled ? "unsupported" : "disabled"); return undefined; }
    let socket;
    let timer;
    let stopped = false;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      const target = new URL(url, window.location.href);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(target);
      socket.onopen = () => { attempts = 0; setConnection("open"); };
      socket.onmessage = ({ data }) => {
        try {
          const payload = JSON.parse(data);
          const event = payload.event || payload;
          if (event?.id) for (const listener of listeners.current) listener(event);
        } catch { /* Ignore malformed transport messages. */ }
      };
      socket.onerror = () => setConnection("error");
      socket.onclose = () => {
        if (stopped) return;
        setConnection("reconnecting");
        const delay = Math.min(30000, 500 * (2 ** attempts++));
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(timer); socket?.close(); setConnection("closed"); };
  }, [enabled, url]);
  const value = useMemo(() => ({ connection, subscribe }), [connection, subscribe]);
  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEvents() {
  const value = useContext(LiveEventsContext);
  return value || { connection: "unavailable", subscribe: () => () => {} };
}

export function useLiveEvent(matcher, callback) {
  const { subscribe } = useLiveEvents();
  const matcherRef = useRef(matcher);
  const callbackRef = useRef(callback);
  matcherRef.current = matcher;
  callbackRef.current = callback;
  useEffect(() => subscribe((event) => { if (!matcherRef.current || matcherRef.current(event)) callbackRef.current(event); }), [subscribe]);
}
