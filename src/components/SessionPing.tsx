"use client";

import { useEffect } from "react";

export default function SessionPing() {
  useEffect(() => {
    let cancelled = false;

    const send = () => {
      if (cancelled) return;
      fetch("/api/session/heartbeat", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {});
    };

    send();
    const id = window.setInterval(send, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") send();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", send);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", send);
    };
  }, []);

  return null;
}
