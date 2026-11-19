import type { Locale } from "@/lib/i18n";

export interface ChangelogEntry {
  date: string;
  title: { en: string; it: string; pl: string; de: string };
  items: { en: string; it: string; pl: string; de: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-11-19",
    title: { en: "Version 1.2", it: "Versione 1.2", pl: "Wersja 1.2", de: "Version 1.2" },
    items: [
      {
        en: "Clearing a filter on a big board is about twice as fast again.",
        it: "Azzerare un filtro su una bacheca grande è di nuovo circa due volte più veloce.",
        pl: "Czyszczenie filtra na dużej tablicy jest znów około dwa razy szybsze.",
        de: "Einen Filter auf einem großen Board zurückzusetzen ist noch einmal etwa doppelt so schnell.",
      },
      {
        en: "A comment sent again after a dropped connection is posted only once, and checklist ticks and comments made offline show on the board card right away.",
        it: "Un commento inviato di nuovo dopo una connessione interrotta viene pubblicato una sola volta, e spunte e commenti fatti offline compaiono subito sulla card della bacheca.",
        pl: "Komentarz wysłany ponownie po zerwanym połączeniu pojawia się tylko raz, a odhaczenia i komentarze zrobione offline od razu widać na karcie na tablicy.",
        de: "Ein nach einem Verbindungsabbruch erneut gesendeter Kommentar erscheint nur einmal, und offline gesetzte Häkchen und Kommentare siehst du sofort auf der Karte im Board.",
      },
    ],
  },
  {
    date: "2026-11-18",
    title: { en: "Version 1.1", it: "Versione 1.1", pl: "Wersja 1.1", de: "Version 1.1" },
    items: [
      {
        en: "Open cards offline too: details stay readable, and checklist ticks and comments sync when you are back online.",
        it: "Apri le card anche offline: i dettagli restano leggibili e spunte della checklist e commenti si sincronizzano quando torni online.",
        pl: "Otwieraj karty także offline: szczegóły są dostępne, a odhaczenia na liście i komentarze synchronizują się po powrocie sieci.",
        de: "Öffne Karten auch offline: Details bleiben lesbar, und Checklisten-Häkchen und Kommentare werden synchronisiert, sobald du wieder online bist.",
      },
      {
        en: "Dragging cards and clearing filters on big boards is about twice as fast.",
        it: "Trascinare le card e azzerare i filtri sulle bacheche grandi è circa due volte più veloce.",
        pl: "Przeciąganie kart i czyszczenie filtrów na dużych tablicach jest około dwa razy szybsze.",
        de: "Karten ziehen und Filter zurücksetzen ist auf großen Boards etwa doppelt so schnell.",
      },
    ],
  },
  {
    date: "2026-11-18",
    title: { en: "Version 1.0", it: "Versione 1.0", pl: "Wersja 1.0", de: "Version 1.0" },
    items: [
      {
        en: "Sign in with your company account (single sign-on), and protect password accounts with two-factor authentication.",
        it: "Accedi con l'account aziendale (single sign-on) e proteggi gli account con password con l'autenticazione a due fattori.",
        pl: "Logowanie kontem firmowym (single sign-on) i ochrona kont z hasłem weryfikacją dwuetapową.",
        de: "Melde dich mit deinem Firmenkonto an (Single Sign-on) und schütze Passwortkonten mit Zwei-Faktor-Authentifizierung.",
      },
      {
        en: "Import boards from Trello or CSV, export them as JSON or CSV, and download a full backup as an admin.",
        it: "Importa bacheche da Trello o CSV, esportale in JSON o CSV e, come admin, scarica un backup completo.",
        pl: "Importuj tablice z Trello lub CSV, eksportuj je do JSON lub CSV, a jako admin pobierz pełną kopię zapasową.",
        de: "Importiere Boards aus Trello oder CSV, exportiere sie als JSON oder CSV und lade als Admin ein vollständiges Backup herunter.",
      },
      {
        en: "Connect other tools with the REST API, personal access tokens and webhooks.",
        it: "Collega altri strumenti con la REST API, i token di accesso personali e i webhook.",
        pl: "Łącz inne narzędzia przez REST API, osobiste tokeny dostępu i webhooki.",
        de: "Verbinde andere Tools über die REST-API, persönliche Zugriffstoken und Webhooks.",
      },
      {
        en: "Boards you opened stay readable offline, and changes you make offline sync when you are back online.",
        it: "Le bacheche aperte restano leggibili offline e le modifiche fatte offline si sincronizzano quando torni online.",
        pl: "Otwierane tablice są dostępne offline, a zmiany zrobione bez sieci synchronizują się po powrocie połączenia.",
        de: "Geöffnete Boards bleiben offline lesbar, und offline gemachte Änderungen werden synchronisiert, sobald du wieder online bist.",
      },
      {
        en: "Big boards are much faster, and the command palette can now move, assign and prioritize cards.",
        it: "Le bacheche grandi sono molto più veloci e la palette dei comandi ora sposta, assegna e cambia priorità alle card.",
        pl: "Duże tablice działają dużo szybciej, a paleta poleceń potrafi teraz przenosić, przypisywać i ustawiać priorytet kart.",
        de: "Große Boards sind viel schneller, und die Befehlspalette kann jetzt Karten verschieben, zuweisen und priorisieren.",
      },
    ],
  },
  {
    date: "2026-11-18",
    title: { en: "Version 0.6.0", it: "Versione 0.6.0", pl: "Wersja 0.6.0", de: "Version 0.6.0" },
    items: [
      {
        en: "See who else is on the board and who has the same card open, and watch teammates' changes slide into place.",
        it: "Vedi chi altro è sulla bacheca e chi ha aperto la stessa card, e guarda le modifiche dei colleghi andare al loro posto.",
        pl: "Zobacz, kto jeszcze jest na tablicy i kto ma otwartą tę samą kartę, a zmiany współpracowników płynnie wskakują na miejsce.",
        de: "Sieh, wer noch auf dem Board ist und wer dieselbe Karte geöffnet hat, und wie Änderungen im Team an ihren Platz gleiten.",
      },
      {
        en: "Watch cards and boards, and choose in Settings which notifications you get in the app, by email or not at all.",
        it: "Segui card e bacheche e scegli nelle Impostazioni quali notifiche ricevere nell'app, via email o per niente.",
        pl: "Obserwuj karty i tablice, a w Ustawieniach wybierz, które powiadomienia dostajesz w aplikacji, e-mailem albo wcale.",
        de: "Beobachte Karten und Boards und wähle in den Einstellungen, welche Benachrichtigungen du in der App, per E-Mail oder gar nicht bekommst.",
      },
      {
        en: "Attach files and images to cards, and give checklist items their own assignee and due date.",
        it: "Allega file e immagini alle card e assegna a ogni voce della checklist una persona e una scadenza.",
        pl: "Dołączaj pliki i obrazy do kart, a punktom listy kontrolnej przypisuj osobę i termin.",
        de: "Hänge Dateien und Bilder an Karten an und gib Checklistenpunkten eine eigene zuständige Person und ein Fälligkeitsdatum.",
      },
      {
        en: "Card templates and cards that repeat every day, week or month.",
        it: "Modelli di card e card che si ripetono ogni giorno, settimana o mese.",
        pl: "Szablony kart i karty powtarzane codziennie, co tydzień albo co miesiąc.",
        de: "Kartenvorlagen und Karten, die sich täglich, wöchentlich oder monatlich wiederholen.",
      },
      {
        en: "A new install now starts with a setup screen in the browser and a first board from a template.",
        it: "Una nuova installazione ora parte con una schermata di configurazione nel browser e una prima bacheca da un modello.",
        pl: "Nowa instalacja zaczyna się teraz od ekranu konfiguracji w przeglądarce i pierwszej tablicy z szablonu.",
        de: "Eine neue Installation beginnt jetzt mit einem Einrichtungsbildschirm im Browser und einem ersten Board aus einer Vorlage.",
      },
    ],
  },
  {
    date: "2026-11-18",
    title: { en: "Version 0.5.0", it: "Versione 0.5.0", pl: "Wersja 0.5.0", de: "Version 0.5.0" },
    items: [
      {
        en: "Press Ctrl+K (Cmd+K on a Mac) to search every board, card and comment.",
        it: "Premi Ctrl+K (Cmd+K su Mac) per cercare in tutte le bacheche, card e commenti.",
        pl: "Naciśnij Ctrl+K (Cmd+K na Macu), aby przeszukać wszystkie tablice, karty i komentarze.",
        de: "Drücke Strg+K (Cmd+K auf dem Mac), um alle Boards, Karten und Kommentare zu durchsuchen.",
      },
      {
        en: "List and calendar views for every board, and saved filters for the whole team.",
        it: "Viste elenco e calendario per ogni bacheca e filtri salvati per tutto il team.",
        pl: "Widok listy i kalendarza dla każdej tablicy oraz zapisane filtry dla całego zespołu.",
        de: "Listen- und Kalenderansicht für jedes Board und gespeicherte Filter fürs ganze Team.",
      },
      {
        en: "Each card now shows its history: who moved, renamed or assigned it, and when.",
        it: "Ogni card mostra la sua cronologia: chi l'ha spostata, rinominata o assegnata, e quando.",
        pl: "Każda karta pokazuje historię: kto ją przeniósł, zmienił nazwę lub przypisał, i kiedy.",
        de: "Jede Karte zeigt ihren Verlauf: wer sie verschoben, umbenannt oder zugewiesen hat, und wann.",
      },
      {
        en: "Pin your favourite boards, see what is overdue at a glance, and find your work grouped by due date.",
        it: "Fissa le bacheche preferite, vedi subito cosa è scaduto e trova il tuo lavoro raggruppato per scadenza.",
        pl: "Przypinaj ulubione tablice, od razu widź zaległości, a swoje zadania znajdziesz pogrupowane według terminu.",
        de: "Hefte Lieblingsboards an, sieh Überfälliges auf einen Blick und finde deine Aufgaben nach Fälligkeit gruppiert.",
      },
    ],
  },
  {
    date: "2026-11-17",
    title: { en: "Version 0.4.0", it: "Versione 0.4.0", pl: "Wersja 0.4.0", de: "Version 0.4.0" },
    items: [
      {
        en: "Drag cards and columns with a mouse, on your phone (press and hold) or with the keyboard.",
        it: "Trascina card e colonne con il mouse, sul telefono (tieni premuto) o con la tastiera.",
        pl: "Przeciągaj karty i kolumny myszą, na telefonie (przytrzymaj) albo klawiaturą.",
        de: "Ziehe Karten und Spalten mit der Maus, auf dem Handy (gedrückt halten) oder mit der Tastatur.",
      },
      {
        en: "Cards open in a side panel, so the board stays where you left it.",
        it: "Le card si aprono in un pannello laterale, così la bacheca resta dove l'hai lasciata.",
        pl: "Karty otwierają się w panelu bocznym, więc tablica zostaje tam, gdzie była.",
        de: "Karten öffnen sich in einem Seitenbereich, das Board bleibt, wo du es verlassen hast.",
      },
      {
        en: "A cleaner card: relative deadlines, a Blocked label and priority only when it matters.",
        it: "Una card più pulita: scadenze relative, etichetta Bloccata e priorità solo quando conta.",
        pl: "Czytelniejsza karta: terminy względne, etykieta Zablokowana i priorytet tylko wtedy, gdy ma znaczenie.",
        de: "Eine klarere Karte: relative Fristen, ein Blockiert-Label und Priorität nur, wenn sie zählt.",
      },
      {
        en: "Menus on cards and columns, \"Move to\", collapsible columns and keyboard shortcuts (press ?).",
        it: "Menu su card e colonne, \"Sposta in\", colonne comprimibili e scorciatoie da tastiera (premi ?).",
        pl: "Menu kart i kolumn, „Przenieś do”, zwijane kolumny i skróty klawiszowe (naciśnij ?).",
        de: "Menüs für Karten und Spalten, „Verschieben nach“, einklappbare Spalten und Tastenkürzel (drücke ?).",
      },
    ],
  },
  {
    date: "2026-11-17",
    title: { en: "Version 0.3.0", it: "Versione 0.3.0", pl: "Wersja 0.3.0", de: "Version 0.3.0" },
    items: [
      {
        en: "Deleted something by mistake? Press Undo, or restore it from the new Trash for 30 days.",
        it: "Eliminato qualcosa per errore? Premi Annulla, oppure ripristinalo dal nuovo Cestino entro 30 giorni.",
        pl: "Usunięte przez pomyłkę? Kliknij Cofnij albo przywróć z nowego Kosza w ciągu 30 dni.",
        de: "Versehentlich gelöscht? Klicke auf Rückgängig oder stelle es 30 Tage lang aus dem neuen Papierkorb wieder her.",
      },
      {
        en: "Admins can deactivate accounts. The person's cards and comments stay.",
        it: "Gli amministratori possono disattivare gli account. Card e commenti della persona restano.",
        pl: "Administratorzy mogą dezaktywować konta. Karty i komentarze tej osoby zostają.",
        de: "Admins können Konten deaktivieren. Karten und Kommentare der Person bleiben erhalten.",
      },
      {
        en: "A fresh look: new typeface, calmer colors and better contrast in light and dark themes.",
        it: "Un aspetto nuovo: nuovo carattere, colori più calmi e contrasto migliore nei temi chiaro e scuro.",
        pl: "Nowy wygląd: nowa czcionka, spokojniejsze kolory i lepszy kontrast w jasnym i ciemnym motywie.",
        de: "Ein frischer Look: neue Schrift, ruhigere Farben und besserer Kontrast im hellen und dunklen Design.",
      },
      {
        en: "When something fails, you now see a short message saying what went wrong.",
        it: "Quando qualcosa non va, ora vedi un breve messaggio che spiega cosa è successo.",
        pl: "Gdy coś się nie uda, zobaczysz krótki komunikat, co poszło nie tak.",
        de: "Wenn etwas fehlschlägt, siehst du jetzt eine kurze Meldung, was schiefgelaufen ist.",
      },
    ],
  },
  {
    date: "2026-11-17",
    title: { en: "Version 0.2.3", it: "Versione 0.2.3", pl: "Wersja 0.2.3", de: "Version 0.2.3" },
    items: [
      {
        en: "The board uses the full window width, so every column is visible.",
        it: "La bacheca usa tutta la larghezza della finestra, così ogni colonna è visibile.",
        pl: "Tablica zajmuje całą szerokość okna, więc widać wszystkie kolumny.",
        de: "Das Board nutzt die volle Fensterbreite, sodass alle Spalten sichtbar sind.",
      },
      {
        en: "Deleting anything now asks for confirmation first.",
        it: "Ora ogni eliminazione chiede prima una conferma.",
        pl: "Każde usuwanie wymaga teraz potwierdzenia.",
        de: "Jedes Löschen fragt jetzt zuerst nach einer Bestätigung.",
      },
      {
        en: "The System theme now follows your operating system.",
        it: "Il tema Sistema ora segue il sistema operativo.",
        pl: "Motyw systemowy podąża teraz za ustawieniem systemu.",
        de: "Das System-Design folgt jetzt deinem Betriebssystem.",
      },
      {
        en: "Upgraded to Next.js 16 and React 19.",
        it: "Aggiornato a Next.js 16 e React 19.",
        pl: "Aktualizacja do Next.js 16 i React 19.",
        de: "Aktualisiert auf Next.js 16 und React 19.",
      },
    ],
  },
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
