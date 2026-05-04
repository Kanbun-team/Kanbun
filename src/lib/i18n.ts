export type Locale = "en" | "pl";

export const LOCALES: Locale[] = ["en", "pl"];
export const DEFAULT_LOCALE: Locale = "en";

type Dict = Record<string, { en: string; pl: string }>;

export const DICT = {
  appName: { en: "Kanbun", pl: "Kanbun" },
  tagline: {
    en: "Self-hosted task boards.",
    pl: "Tablice zadan we wlasnym hostingu.",
  },

  // nav
  navTasks: { en: "Tasks", pl: "Zadania" },
  navMyTasks: { en: "My tasks", pl: "Moje zadania" },
  navBoards: { en: "Boards", pl: "Tablice" },
  navAdmin: { en: "Admin", pl: "Admin" },
  navSettings: { en: "Settings", pl: "Ustawienia" },
  navProfile: { en: "Profile", pl: "Profil" },
  navWhatsNew: { en: "What's new", pl: "Co nowego" },
  navLogout: { en: "Log out", pl: "Wyloguj" },
  navOpenMenu: { en: "Open menu", pl: "Otworz menu" },
  navCloseMenu: { en: "Close menu", pl: "Zamknij menu" },

  // auth
  authLogin: { en: "Log in", pl: "Log in" },
  authUsername: { en: "Username", pl: "Username" },
  authPassword: { en: "Password", pl: "Password" },
  authSignIn: { en: "Sign in", pl: "Sign in" },
  authInvalid: { en: "Invalid username or password.", pl: "Invalid username or password." },

  // common
  save: { en: "Save", pl: "Zapisz" },
  cancel: { en: "Cancel", pl: "Anuluj" },
  delete: { en: "Delete", pl: "Usun" },
  create: { en: "Create", pl: "Utworz" },
  add: { en: "Add", pl: "Dodaj" },
  edit: { en: "Edit", pl: "Edytuj" },
  rename: { en: "Rename", pl: "Zmien nazwe" },
  loading: { en: "Loading...", pl: "Ladowanie..." },
  none: { en: "None", pl: "Brak" },
  optional: { en: "Optional", pl: "Opcjonalne" },
  yes: { en: "Yes", pl: "Tak" },
  no: { en: "No", pl: "Nie" },
  back: { en: "Back", pl: "Wstecz" },
  search: { en: "Search", pl: "Szukaj" },
  open: { en: "Open", pl: "Otworz" },
  close: { en: "Close", pl: "Zamknij" },
  online: { en: "Online", pl: "Online" },
  offline: { en: "Offline", pl: "Offline" },
  lastSeen: { en: "Last seen", pl: "Ostatnio widziany" },

  // boards
  boardsTitle: { en: "Boards", pl: "Tablice" },
  boardsEmpty: {
    en: "You are not a member of any boards yet.",
    pl: "Nie nalezysz jeszcze do zadnej tablicy.",
  },
  boardCreate: { en: "Create board", pl: "Utworz tablice" },
  boardName: { en: "Board name", pl: "Nazwa tablicy" },
  boardDescription: { en: "Description", pl: "Opis" },
  boardArchived: { en: "Archived", pl: "Zarchiwizowana" },
  boardSettings: { en: "Board settings", pl: "Ustawienia tablicy" },
  boardArchive: { en: "Archive board", pl: "Zarchiwizuj tablice" },
  boardUnarchive: { en: "Unarchive board", pl: "Przywroc tablice" },
  boardDelete: { en: "Delete board", pl: "Usun tablice" },
  boardMembers: { en: "Members", pl: "Czlonkowie" },
  boardTags: { en: "Tags", pl: "Tagi" },
  boardOwner: { en: "Owner", pl: "Wlasciciel" },
  boardMember: { en: "Member", pl: "Czlonek" },
  boardAddMember: { en: "Add member", pl: "Dodaj czlonka" },
  boardRemoveMember: { en: "Remove", pl: "Usun" },
  boardMakeOwner: { en: "Make owner", pl: "Ustaw wlascicielem" },
  boardMakeMember: { en: "Make member", pl: "Ustaw czlonkiem" },

  // columns
  columnAdd: { en: "Add column", pl: "Dodaj kolumne" },
  columnRename: { en: "Rename column", pl: "Zmien nazwe kolumny" },
  columnDelete: { en: "Delete column", pl: "Usun kolumne" },
  columnName: { en: "Column name", pl: "Nazwa kolumny" },

  // cards
  cardAdd: { en: "Add card", pl: "Dodaj karte" },
  cardTitle: { en: "Title", pl: "Tytul" },
  cardDescription: { en: "Description", pl: "Opis" },
  cardPriority: { en: "Priority", pl: "Priorytet" },
  cardDeadline: { en: "Deadline", pl: "Termin" },
  cardAssignees: { en: "Assignees", pl: "Przypisani" },
  cardTags: { en: "Tags", pl: "Tagi" },
  cardSubtasks: { en: "Subtasks", pl: "Podzadania" },
  cardComments: { en: "Comments", pl: "Komentarze" },
  cardBlocking: { en: "Blocking", pl: "Blokuje" },
  cardBlockedBy: { en: "Blocked by", pl: "Zablokowana przez" },
  cardDelete: { en: "Delete card", pl: "Usun karte" },
  cardNoDeadline: { en: "No deadline", pl: "Brak terminu" },
  cardNoAssignees: { en: "No assignees", pl: "Brak przypisanych" },
  cardNoTags: { en: "No tags", pl: "Brak tagow" },
  cardNoComments: { en: "No comments yet.", pl: "Brak komentarzy." },
  cardNoSubtasks: { en: "No subtasks.", pl: "Brak podzadan." },
  cardWriteComment: { en: "Write a comment", pl: "Napisz komentarz" },
  cardPostComment: { en: "Post comment", pl: "Dodaj komentarz" },
  cardSubtaskAdd: { en: "Add subtask", pl: "Dodaj podzadanie" },
  cardBlockAdd: { en: "Add block", pl: "Dodaj blokade" },
  cardBlockSelectCard: { en: "Select card", pl: "Wybierz karte" },

  priorityLow: { en: "Low", pl: "Niski" },
  priorityNormal: { en: "Normal", pl: "Normalny" },
  priorityHigh: { en: "High", pl: "Wysoki" },
  priorityCritical: { en: "Critical", pl: "Krytyczny" },

  // settings
  settingsTitle: { en: "Settings", pl: "Ustawienia" },
  settingsTheme: { en: "Theme", pl: "Motyw" },
  settingsLanguage: { en: "Language", pl: "Jezyk" },
  settingsAvatar: { en: "Avatar URL", pl: "URL awatara" },
  settingsDisplayName: { en: "Display name", pl: "Nazwa wyswietlana" },
  themeLight: { en: "Light", pl: "Jasny" },
  themeDark: { en: "Dark", pl: "Ciemny" },
  themeSystem: { en: "System", pl: "Systemowy" },
  langEnglish: { en: "English", pl: "Angielski" },
  langPolish: { en: "Polish", pl: "Polski" },

  // admin
  adminUsers: { en: "Users", pl: "Uzytkownicy" },
  adminCreateUser: { en: "Create user", pl: "Utworz uzytkownika" },
  adminResetPassword: { en: "Reset password", pl: "Zresetuj haslo" },
  adminDeleteUser: { en: "Delete user", pl: "Usun uzytkownika" },
  adminRole: { en: "Role", pl: "Rola" },
  adminAccessTasks: { en: "Tasks access", pl: "Dostep do zadan" },
  roleSupport: { en: "Support", pl: "Wsparcie" },
  roleDev: { en: "Developer", pl: "Programista" },
  roleMod: { en: "Moderator", pl: "Moderator" },
  roleAdmin: { en: "Admin", pl: "Admin" },
  roleMember: { en: "Member", pl: "Czlonek" },

  // profile
  profileCounters: { en: "Activity", pl: "Aktywnosc" },
  profileAssignedNow: { en: "Currently assigned", pl: "Aktualnie przypisane" },
  profileLatestMoves: { en: "Latest moves", pl: "Ostatnie ruchy" },
  profileLatestComments: { en: "Latest comments", pl: "Ostatnie komentarze" },
  profileHeatmap: { en: "Activity heatmap", pl: "Mapa aktywnosci" },
  profileActiveSessions: { en: "Active sessions", pl: "Aktywne sesje" },
  profileRecentSessions: { en: "Recent sessions", pl: "Niedawne sesje" },
  profileSessionWeb: { en: "Web", pl: "Web" },
  profileSessionMobile: { en: "Mobile", pl: "Mobile" },
  profileSessionDesktop: { en: "Desktop", pl: "Desktop" },

  // whats new
  whatsNewTitle: { en: "What's new", pl: "Co nowego" },

  // my tasks
  myTasksTitle: { en: "My tasks", pl: "Moje zadania" },
  myTasksEmpty: {
    en: "You don't have any cards assigned right now.",
    pl: "Nie masz aktualnie zadnych przypisanych kart.",
  },

  // misc
  required: { en: "Required", pl: "Wymagane" },
  unknown: { en: "Unknown", pl: "Nieznany" },
  createdBy: { en: "Created by", pl: "Utworzone przez" },
  noResults: { en: "No results.", pl: "Brak wynikow." },
  cardsCount: { en: "Cards", pl: "Karty" },
  commentsCount: { en: "Comments", pl: "Komentarze" },
  movesCount: { en: "Moves", pl: "Ruchy" },
  subtasksCount: { en: "Subtasks done", pl: "Ukonczone podzadania" },
  footerCopyright: { en: "All rights reserved.", pl: "Wszelkie prawa zastrzezone." },

  // months (short, locale already does long, but used in heatmap)
  monthJan: { en: "Jan", pl: "Sty" },
  monthFeb: { en: "Feb", pl: "Lut" },
  monthMar: { en: "Mar", pl: "Mar" },
  monthApr: { en: "Apr", pl: "Kwi" },
  monthMay: { en: "May", pl: "Maj" },
  monthJun: { en: "Jun", pl: "Cze" },
  monthJul: { en: "Jul", pl: "Lip" },
  monthAug: { en: "Aug", pl: "Sie" },
  monthSep: { en: "Sep", pl: "Wrz" },
  monthOct: { en: "Oct", pl: "Pas" },
  monthNov: { en: "Nov", pl: "Lis" },
  monthDec: { en: "Dec", pl: "Gru" },
} satisfies Dict;

export type DictKey = keyof typeof DICT;

export function t(key: DictKey, locale: Locale = DEFAULT_LOCALE): string {
  const entry = DICT[key];
  return entry[locale] ?? entry.en;
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "pl";
}

export function intlLocale(locale: Locale): string {
  return locale === "pl" ? "pl-PL" : "en-GB";
}

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
