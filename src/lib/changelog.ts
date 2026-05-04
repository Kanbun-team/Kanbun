import type { Locale } from "@/lib/i18n";

export interface ChangelogEntry {
  date: string;
  title: { en: string; it: string; pl: string };
  items: { en: string; it: string; pl: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-05-03",
    title: { en: "Initial release", it: "Rilascio iniziale", pl: "Pierwsze wydanie" },
    items: [
      {
        en: "Boards, columns, and cards with drag-and-drop.",
        it: "Boards, colonne e cards con trascinamento.",
        pl: "Tablice, kolumny i karty z przeciaganiem.",
      },
      {
        en: "Subtasks, tags, comments, blocking dependencies.",
        it: "Sottoattività, tag, commenti, dipendenze di blocco.",
        pl: "Podzadania, tagi, komentarze, zaleznosci blokujace.",
      },
      {
        en: "User profiles with activity heatmap and session tracking.",
        it: "Profili utente con mappa di attività e tracciamento delle sessioni.",
        pl: "Profile uzytkownikow z mapa aktywnosci i sesjami.",
      },
      {
        en: "Admin panel for managing users and roles.",
        it: "Pannello di amministrazione per gestire utenti e ruoli.",
        pl: "Panel administratora do zarzadzania uzytkownikami.",
      },
      { en: "PWA with mobile-friendly nav.",
        it: "PWA con navigazione mobile-friendly.",
        pl: "PWA z mobilna nawigacja."
      },
    ],
  },
];

export function localizedTitle(entry: ChangelogEntry, locale: Locale): string {
  return entry.title[locale] ?? entry.title.en;
}

export function localizedItems(entry: ChangelogEntry, locale: Locale): string[] {
  return entry.items.map((it) => it[locale] ?? it.en);
}
