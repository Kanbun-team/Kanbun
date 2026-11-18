"use client";

import { useState } from "react";

// Local state that resets whenever `source` changes (e.g. server props after
// router.refresh()), while still allowing optimistic local edits in between.
// `merge` (optional) builds the new value from the current one and the new
// source, e.g. to keep unchanged objects for memoized children.
//
// Uses React's "adjust state during render" pattern instead of a useEffect,
// which would render once with the stale value and then again with the new
// one: https://react.dev/learn/you-might-not-need-an-effect
export function useSyncedState<T>(source: T, merge?: (current: T, next: T) => T) {
  const [value, setValue] = useState(source);
  const [prev, setPrev] = useState(source);
  if (!Object.is(prev, source)) {
    setPrev(source);
    setValue(merge ? merge(value, source) : source);
  }
  return [value, setValue] as const;
}
