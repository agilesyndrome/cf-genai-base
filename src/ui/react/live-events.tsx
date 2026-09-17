import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppEvent } from "../../core/events/index.js";

export type LiveEventConnection = "connecting" | "disabled" | "unsupported" | "open" | "error" | "reconnecting" | "closed" | "unavailable";
export type LiveEventListener = (event: AppEvent) => void;
export type LiveEventMatcher = (event: AppEvent) => boolean;
export interface LiveEventsContextValue { connection: LiveEventConnection; subscribe: (listener: LiveEventListener) => () => void }
export interface LiveEventsProviderProps { children?: ReactNode; url?: string; enabled?: boolean }

const unavailableContext: LiveEventsContextValue = { connection: "unavailable", subscribe: () => () => undefined };
const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

export function LiveEventsProvider({ children, url = "/api/events", enabled = true }: LiveEventsProviderProps) {
  const listeners = useRef(new Set<LiveEventListener>());
  const [connection, setConnection] = useState<LiveEventConnection>(enabled ? "connecting" : "disabled");
  const subscribe = useCallback((listener: LiveEventListener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") { setConnection(enabled ? "unsupported" : "disabled"); return undefined; }
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      const target = new URL(url, window.location.href);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(target);
      socket.onopen = () => { attempts = 0; setConnection("open"); };
      socket.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== "string") return;
        try {
          const payload: unknown = JSON.parse(data);
          const event = readTransportEvent(payload);
          if (event) for (const listener of listeners.current) listener(event);
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
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); socket?.close(); setConnection("closed"); };
  }, [enabled, url]);
  const value = useMemo<LiveEventsContextValue>(() => ({ connection, subscribe }), [connection, subscribe]);
  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEvents(): LiveEventsContextValue { return useContext(LiveEventsContext) || unavailableContext; }

export function useLiveEvent(matcher: LiveEventMatcher | null | undefined, callback: LiveEventListener): void {
  const { subscribe } = useLiveEvents();
  const matcherRef = useRef(matcher);
  const callbackRef = useRef(callback);
  matcherRef.current = matcher;
  callbackRef.current = callback;
  useEffect(() => subscribe((event) => { if (!matcherRef.current || matcherRef.current(event)) callbackRef.current(event); }), [subscribe]);
}

function readTransportEvent(value: unknown): AppEvent | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const nested: unknown = Reflect.get(value, "event");
  const candidate = nested ?? value;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const id: unknown = Reflect.get(candidate, "id");
  const details: unknown = Reflect.get(candidate, "details");
  if (typeof id !== "string" || typeof Reflect.get(candidate, "what") !== "string" || details === null || typeof details !== "object" || Array.isArray(details)) return null;
  return {
    id,
    what: String(Reflect.get(candidate, "what")),
    who: String(Reflect.get(candidate, "who") || "system"),
    where: String(Reflect.get(candidate, "where") || "application"),
    when: String(Reflect.get(candidate, "when") || ""),
    details: jsonObject(details),
  };
}

function jsonObject(value: object): Record<string, import("../../core/events/index.js").EventJsonValue> {
  const result: Record<string, import("../../core/events/index.js").EventJsonValue> = {};
  for (const [key, item] of Object.entries(value)) if (isJsonValue(item)) result[key] = item;
  return result;
}

function isJsonValue(value: unknown): value is import("../../core/events/index.js").EventJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value).every(isJsonValue);
}
