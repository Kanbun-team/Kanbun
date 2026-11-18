// Client-safe helpers for @mention autocomplete in the comment box. The
// server side (parsing mentions to notify) is parseMentions in notifications.ts;
// the rules match: a mention starts at "@" not preceded by [a-z0-9_].

export interface MentionCandidate {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * The mention being typed at the caret: "Hi @ma|" gives { start: 3, query: "ma" }.
 * Null when the caret is not right after "@" plus username characters.
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|[^a-z0-9_])@([a-z0-9_.-]{0,40})$/i.exec(before);
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

/** Replace the mention being typed with "@username " and return the new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  username: string
): { text: string; caret: number } {
  // Swallow the rest of a half-typed name after the caret ("@ma|rt" -> "@marta ").
  let end = caret;
  while (end < text.length && /[a-z0-9_.-]/i.test(text[end])) end += 1;
  const insert = `@${username} `;
  const rest = text.slice(end).replace(/^ /, "");
  return { text: text.slice(0, start) + insert + rest, caret: start + insert.length };
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Members matching the query: username prefix first, then any word of the
 * display name starting with it, then anything containing it. Accents are
 * ignored, so "wis" finds "Wiśniewski".
 */
export function filterMentionCandidates<T extends MentionCandidate>(members: T[], query: string, limit = 6): T[] {
  const q = fold(query);
  const scored: { m: T; score: number }[] = [];
  for (const m of members) {
    const user = fold(m.username);
    const name = fold(m.displayName ?? "");
    let score = -1;
    if (user.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if (user.includes(q) || name.includes(q)) score = 2;
    if (score >= 0) scored.push({ m, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.m.username.localeCompare(b.m.username))
    .slice(0, limit)
    .map((s) => s.m);
}
