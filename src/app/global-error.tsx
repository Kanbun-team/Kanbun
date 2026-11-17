"use client";

// Last-resort boundary for errors in the root layout itself. It replaces the
// whole document, so it cannot rely on the app's providers or translations.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "6rem 1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: "0.5rem", color: "#5B6170" }}>Kanbun could not load. Try again in a moment.</p>
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: "1.5rem", padding: "0.5rem 1rem", borderRadius: 6, background: "#2B4C9B", color: "#fff", border: 0 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
