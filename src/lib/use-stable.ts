"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Helpers that keep object identities stable across renders, so memoized
// children (React.memo) are not re-rendered by props that only look new.

/**
 * An object with the same methods as `handlers` whose identity never changes.
 * Each method calls the latest version, so it always sees current state. Only
 * call them from events and effects, not during render.
 */
export function useStableHandlers<T extends object>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const [stable] = useState(() => {
    const out = {} as Record<string, unknown>;
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: unknown[]) =>
        (latest.current as Record<string, (...a: unknown[]) => unknown>)[key](...args);
    }
    return out as T;
  });
  return stable;
}

/**
 * `value`, or the previous value while it is structurally equal (compared as
 * JSON). For small, serializable props such as member and tag lists that the
 * server sends again on every refresh.
 */
export function useStableValue<T>(value: T): T {
  const [state, setState] = useState(() => ({ source: value, value, json: JSON.stringify(value) }));
  if (state.source !== value) {
    const json = JSON.stringify(value);
    const next = json === state.json ? { ...state, source: value } : { source: value, value, json };
    setState(next);
    return next.value;
  }
  return state.value;
}
