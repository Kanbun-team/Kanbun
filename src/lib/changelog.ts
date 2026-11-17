import type { Locale } from "@/lib/i18n";

export interface ChangelogEntry {
  date: string;
  title: { en: string; it: string; pl: string; de: string };
  items: { en: string; it: string; pl: string; de: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-11-17",
    title: { en: "Version 0.2.2", it: "Versione 0.2.2", pl: "Wersja 0.2.2", de: "Version 0.2.2" },
    items: [
      {
        en: "@mentions followed by punctuation now notify the right person.",
        it: "Le @menzioni seguite da punteggiatura ora avvisano la persona giusta.",
        pl: "@wzmianki z interpunkcją na końcu powiadamiają teraz właściwą osobę.",
        de: "@Erwähnungen mit nachfolgendem Satzzeichen benachrichtigen jetzt die richtige Person.",
      },
      {
        en: "Markdown fixes for code and links.",
        it: "Correzioni Markdown per codice e link.",
        pl: "Poprawki Markdown dla kodu i linków.",
        de: "Markdown-Korrekturen für Code und Links.",
      },
      {
        en: "Complete German, Italian and Polish translations.",
        it: "Traduzioni complete in tedesco, italiano e polacco.",
        pl: "Pełne tłumaczenia niemieckie, włoskie i polskie, z polskimi znakami.",
        de: "Vollständige deutsche, italienische und polnische Übersetzungen.",
      },
    ],
  },
  {
    date: "2026-11-17",
    title: { en: "Version 0.2.1", it: "Versione 0.2.1", pl: "Wersja 0.2.1", de: "Version 0.2.1" },
    items: [
      {
        en: "Security: removing a user, changing their role, or resetting their password now takes effect immediately.",
        it: "Sicurezza: eliminare un utente, cambiarne il ruolo o reimpostarne la password ha effetto immediato.",
        pl: "Bezpieczeństwo: usunięcie użytkownika, zmiana jego roli lub reset hasła działają natychmiast.",
        de: "Sicherheit: Das Löschen eines Benutzers, eine Rollenänderung oder ein Passwort-Reset wirken sofort.",
      },
      {
        en: "Repeated failed logins are now rate limited.",
        it: "I tentativi di accesso falliti ripetuti ora sono limitati.",
        pl: "Powtarzające się nieudane logowania są teraz ograniczane.",
        de: "Wiederholte fehlgeschlagene Anmeldungen werden jetzt begrenzt.",
      },
      {
        en: "Only board members can be assigned to a card.",
        it: "Solo i membri della board possono essere assegnati a una card.",
        pl: "Do karty można przypisać tylko członków tablicy.",
        de: "Nur Board-Mitglieder können einer Karte zugewiesen werden.",
      },
      {
        en: "Dependency updates with upstream security fixes.",
        it: "Aggiornamenti delle dipendenze con correzioni di sicurezza.",
        pl: "Aktualizacje zależności z poprawkami bezpieczeństwa.",
        de: "Aktualisierte Abhängigkeiten mit Sicherheitskorrekturen.",
      },
    ],
  },
  {
    date: "2026-06-17",
    title: { en: "Version 0.2.0", it: "Versione 0.2.0", pl: "Wersja 0.2.0", de: "Version 0.2.0" },
    items: [
      {
        en: "Live board updates: changes appear for everyone without a refresh.",
        it: "Aggiornamenti live: le modifiche appaiono a tutti senza ricaricare.",
        pl: "Aktualizacje na żywo: zmiany pojawiają się u wszystkich bez odświeżania.",
        de: "Live-Updates: Änderungen erscheinen bei allen ohne Neuladen.",
      },
      {
        en: "Filter and search the board by title, assignee, tag, priority, and deadline.",
        it: "Filtra e cerca nella board per titolo, assegnatario, tag, priorità e scadenza.",
        pl: "Filtruj i szukaj na tablicy po tytule, osobie, tagu, priorytecie i terminie.",
        de: "Board nach Titel, Zuständigem, Tag, Priorität und Frist filtern und durchsuchen.",
      },
      {
        en: "Markdown in card descriptions and comments.",
        it: "Markdown nelle descrizioni delle card e nei commenti.",
        pl: "Markdown w opisach kart i komentarzach.",
        de: "Markdown in Kartenbeschreibungen und Kommentaren.",
      },
      {
        en: "WIP limits per column and card cover colors.",
        it: "Limiti WIP per colonna e colori di copertina delle card.",
        pl: "Limity WIP dla kolumn i kolory okładek kart.",
        de: "WIP-Limits pro Spalte und Karten-Titelfarben.",
      },
      {
        en: "In-app notifications with @mentions and a live unread badge.",
        it: "Notifiche in-app con @menzioni e badge dei non letti in tempo reale.",
        pl: "Powiadomienia w aplikacji z @wzmiankami i licznikiem nieprzeczytanych na żywo.",
        de: "In-App-Benachrichtigungen mit @Erwähnungen und Live-Zähler für Ungelesene.",
      },
      {
        en: "Reworked card sidebar with direct inline controls.",
        it: "Barra laterale della card rinnovata con controlli inline diretti.",
        pl: "Przebudowany panel karty z bezpośrednimi kontrolkami inline.",
        de: "Überarbeitete Karten-Seitenleiste mit direkten Inline-Steuerelementen.",
      },
    ],
  },
  {
    date: "2026-05-03",
    title: { en: "Initial release", it: "Rilascio iniziale", pl: "Pierwsze wydanie", de: "Erstveröffentlichung" },
    items: [
      {
        en: "Boards, columns, and cards with drag-and-drop.",
        it: "Boards, colonne e cards con trascinamento.",
        pl: "Tablice, kolumny i karty z przeciąganiem.",
        de: "Boards, Spalten und Karten per Drag & Drop.",
      },
      {
        en: "Subtasks, tags, comments, blocking dependencies.",
        it: "Sottoattività, tag, commenti, dipendenze di blocco.",
        pl: "Podzadania, tagi, komentarze, zależności blokujące.",
        de: "Unteraufgaben, Tags, Kommentare, blockierende Abhängigkeiten.",
      },
      {
        en: "User profiles with activity heatmap and session tracking.",
        it: "Profili utente con mappa di attività e tracciamento delle sessioni.",
        pl: "Profile użytkowników z mapą aktywności i sesjami.",
        de: "Benutzerprofile mit Aktivitäts-Heatmap und Sitzungsverfolgung.",
      },
      {
        en: "Admin panel for managing users and roles.",
        it: "Pannello di amministrazione per gestire utenti e ruoli.",
        pl: "Panel administratora do zarządzania użytkownikami.",
        de: "Admin-Bereich zur Verwaltung von Benutzern und Rollen.",
      },
      { en: "PWA with mobile-friendly nav.",
        it: "PWA con navigazione mobile-friendly.",
        pl: "PWA z mobilną nawigacją.",
        de: "PWA mit mobilfreundlicher Navigation.",
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
