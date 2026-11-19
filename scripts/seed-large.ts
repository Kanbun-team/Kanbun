// Adds one large board (500 cards over 6 columns, with tags, assignees,
// checklists, comments, a few blockers and a few months of card history) for
// performance testing, see
// docs/PERFORMANCE.md. Unlike seed-demo it runs on a database that already
// has users (for example the e2e database after seed-demo): the board's
// members are the existing users. On an empty database it creates an admin
// (password "demo1234") first. Running it again replaces the previous large
// board. Prints the board id.
//
//   DATABASE_URL=file:./e2e.db npm run seed:large
//   SEED_LARGE_CARDS=1000 npm run seed:large    (another card count)
//   npm run seed:large -- --remove              (delete the large board)
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db-local";

const LARGE_BOARD_NAME = "Large board (performance)";
const CARD_COUNT = Math.max(1, Number(process.env.SEED_LARGE_CARDS ?? 500) || 500);
const COLUMNS = ["Backlog", "To do", "In progress", "Review", "Blocked", "Done"];
// How the cards spread over the columns (sums to 1).
const SHARE = [0.3, 0.2, 0.15, 0.1, 0.05, 0.2];
const TAGS: [string, string][] = [
  ["Design", "#db2777"],
  ["Frontend", "#2563eb"],
  ["Backend", "#7c3aed"],
  ["Content", "#ea580c"],
  ["Bug", "#dc2626"],
  ["Ops", "#16a34a"],
  ["Research", "#0891b2"],
  ["Mobile", "#ca8a04"],
];
const VERBS = ["Fix", "Design", "Write", "Review", "Refactor", "Test", "Document", "Migrate", "Plan", "Ship"];
const NOUNS = [
  "login flow",
  "billing page",
  "search index",
  "onboarding email",
  "card menu",
  "export to CSV",
  "dark theme",
  "release notes",
  "API rate limits",
  "notification digest",
  "mobile navigation",
  "audit log filters",
  "board settings",
  "webhook retries",
  "calendar view",
];
const DAY = 24 * 60 * 60 * 1000;

// Deterministic, so every run produces the same board shape.
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
// Card history uses its own sequence, so the board itself (titles, tags,
// assignees) stays the same as before history was added.
let historySeed = 7;
function hrand() {
  historySeed = (historySeed * 1664525 + 1013904223) % 4294967296;
  return historySeed / 4294967296;
}
// Average days a card stays in each column before it moves on.
const MEAN_STAY_DAYS = [12, 5, 3, 1.5, 4, 0];
const stayMs = (column: number) => -Math.log(1 - hrand()) * MEAN_STAY_DAYS[column] * DAY + 60_000;
const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
function sample<T>(items: T[], n: number): T[] {
  const copy = [...items];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}
// cuid-like ids, so rows can be linked before they are inserted.
const id = () => "c" + randomBytes(12).toString("hex").slice(0, 24);

async function ensureUsers() {
  const users = await prisma.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (users.length > 0) return users;
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const admin = await prisma.user.create({
    data: { username: "admin", displayName: "Ada Admin", role: "admin", passwordHash },
    select: { id: true, role: true },
  });
  console.log('No users found: created "admin" with password "demo1234".');
  return [admin];
}

async function main() {
  const users = await ensureUsers();
  const owner = users.find((u) => u.role === "admin") ?? users[0];
  const people = users.slice(0, 8);

  const old = await prisma.board.findMany({ where: { name: LARGE_BOARD_NAME }, select: { id: true } });
  if (old.length) {
    const ids = old.map((b) => b.id);
    // Card history has no relation to the card, so it goes separately.
    await prisma.cardActivity.deleteMany({ where: { boardId: { in: ids } } });
    await prisma.board.deleteMany({ where: { id: { in: ids } } });
  }
  if (process.argv.includes("--remove")) {
    console.log(old.length ? "Large board removed." : "No large board found.");
    return;
  }

  const maxPosition = await prisma.board.aggregate({ _max: { position: true } });
  const board = await prisma.board.create({
    data: {
      name: LARGE_BOARD_NAME,
      description: `${CARD_COUNT} cards for performance testing (scripts/seed-large.ts).`,
      color: "#0891b2",
      position: (maxPosition._max.position ?? 0) + 1,
      createdById: owner.id,
      members: {
        create: people.map((u) => ({ userId: u.id, role: u.id === owner.id || u.role === "admin" ? "owner" : "member" })),
      },
      tags: { create: TAGS.map(([name, color], position) => ({ name, color, position })) },
      columns: { create: COLUMNS.map((name, position) => ({ name, position })) },
    },
    include: { tags: true, columns: { orderBy: { position: "asc" } } },
  });

  const cards: {
    id: string;
    columnId: string;
    title: string;
    description: string | null;
    position: number;
    priority: string;
    coverColor: string | null;
    deadline: Date | null;
    createdById: string;
    createdAt: Date;
  }[] = [];
  const tagRows: { cardId: string; tagId: string }[] = [];
  const assigneeRows: { cardId: string; userId: string }[] = [];
  const subtaskRows: { cardId: string; title: string; done: boolean; position: number; completedAt: Date | null }[] = [];
  const commentRows: { cardId: string; authorId: string; body: string }[] = [];
  const activityRows: { cardId: string; boardId: string; type: string; data: string; actorId: string; createdAt: Date }[] = [];

  const now = Date.now();
  // The columns a card went through to reach column `current`, oldest first:
  // Backlog onwards (some start in To do, a few were added straight to
  // Done), with the occasional trip back from Review or through Blocked.
  function historyPath(current: number): number[] {
    if (current === 5 && hrand() < 0.03) return [5];
    const path: number[] = [];
    for (let c = hrand() < 0.15 ? Math.min(current, 1) : 0; c <= Math.min(current, 3); c++) path.push(c);
    if (current === 4) path.push(4);
    if (current === 5) {
      if (hrand() < 0.1) path.splice(path.indexOf(2) + 1, 0, 4, 2);
      if (hrand() < 0.12) path.splice(path.lastIndexOf(3) + 1, 0, 2, 3);
      path.push(5);
    }
    return path;
  }
  let n = 0;
  board.columns.forEach((column, ci) => {
    const count = ci === board.columns.length - 1 ? CARD_COUNT - n : Math.round(CARD_COUNT * SHARE[ci]);
    for (let position = 0; position < count; position++) {
      n++;
      const cardId = id();
      const r = rand();
      cards.push({
        id: cardId,
        columnId: column.id,
        title: `${pick(VERBS)} ${pick(NOUNS)} #${n}`,
        description: rand() < 0.3 ? `Notes for card ${n}.\n\n- first point\n- second point` : null,
        position,
        priority: r < 0.05 ? "critical" : r < 0.2 ? "high" : r < 0.4 ? "low" : "normal",
        coverColor: rand() < 0.08 ? pick(TAGS)[1] : null,
        deadline: rand() < 0.45 ? new Date(Math.floor((now + Math.round((rand() * 60 - 15)) * DAY) / DAY) * DAY) : null,
        createdById: owner.id,
        createdAt: new Date(now),
      });
      // Walk back from now: the time in the current column, then the stays
      // before it. Done cards finished at some point in the last 110 days;
      // one card in ten has sat in its column four times longer than usual.
      const path = historyPath(ci);
      const times: number[] = new Array(path.length);
      times[path.length - 1] =
        now - (ci === 5 ? hrand() * 110 * DAY : stayMs(ci) * (hrand() < 0.1 ? 4 : 1));
      for (let i = path.length - 2; i >= 0; i--) times[i] = times[i + 1] - stayMs(path[i]);
      cards[cards.length - 1].createdAt = new Date(times[0]);
      const col = (i: number) => board.columns[path[i]];
      activityRows.push({
        cardId,
        boardId: board.id,
        type: "created",
        data: JSON.stringify({ column: col(0).name, columnId: col(0).id }),
        actorId: owner.id,
        createdAt: new Date(times[0]),
      });
      for (let i = 1; i < path.length; i++) {
        activityRows.push({
          cardId,
          boardId: board.id,
          type: "moved",
          data: JSON.stringify({ from: col(i - 1).name, to: col(i).name, fromId: col(i - 1).id, toId: col(i).id }),
          actorId: people[Math.floor(hrand() * people.length)].id,
          createdAt: new Date(times[i]),
        });
      }
      for (const tag of sample(board.tags, Math.floor(rand() * 3))) tagRows.push({ cardId, tagId: tag.id });
      for (const user of sample(people, Math.floor(rand() * 3))) assigneeRows.push({ cardId, userId: user.id });
      if (rand() < 0.4) {
        const total = 1 + Math.floor(rand() * 6);
        for (let i = 0; i < total; i++) {
          const done = rand() < 0.5;
          subtaskRows.push({ cardId, title: `Step ${i + 1}`, done, position: i, completedAt: done ? new Date(now) : null });
        }
      }
      if (rand() < 0.35) {
        const total = 1 + Math.floor(rand() * 4);
        for (let i = 0; i < total; i++) commentRows.push({ cardId, authorId: pick(people).id, body: `Comment ${i + 1} on card ${n}.` });
      }
    }
  });

  // A few blockers, between distinct cards.
  const blockRows: { blockerId: string; blockedId: string; createdById: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(30, Math.floor(cards.length / 10)); i++) {
    const [a, b] = sample(cards, 2);
    if (!a || !b || seen.has(`${a.id}:${b.id}`)) continue;
    seen.add(`${a.id}:${b.id}`);
    blockRows.push({ blockerId: a.id, blockedId: b.id, createdById: owner.id });
  }

  const chunk = <T,>(rows: T[], size = 200) =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
  for (const rows of chunk(cards)) await prisma.taskCard.createMany({ data: rows });
  for (const rows of chunk(tagRows)) await prisma.taskCardTag.createMany({ data: rows });
  for (const rows of chunk(assigneeRows)) await prisma.taskCardAssignee.createMany({ data: rows });
  for (const rows of chunk(subtaskRows)) await prisma.taskSubtask.createMany({ data: rows });
  for (const rows of chunk(commentRows)) await prisma.taskCardComment.createMany({ data: rows });
  for (const rows of chunk(blockRows)) await prisma.taskBlock.createMany({ data: rows });
  for (const rows of chunk(activityRows, 500)) await prisma.cardActivity.createMany({ data: rows });

  console.log(
    `Large board created: ${cards.length} cards, ${tagRows.length} tags, ${assigneeRows.length} assignees, ` +
      `${subtaskRows.length} checklist items, ${commentRows.length} comments, ${blockRows.length} blockers, ` +
      `${activityRows.length} history entries.`
  );
  console.log(`Board id: ${board.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
