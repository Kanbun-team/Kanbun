// Fills an EMPTY database with a realistic demo workspace (users, boards,
// cards). Used for local development, screenshots and trying Kanbun out.
// Every demo user's password is "demo1234". Refuses to run on a database that
// already has users, so it can never touch real data.
import { prisma } from "../src/lib/db-local";
import { nextOccurrence } from "../src/lib/recurrence";
import bcrypt from "bcryptjs";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);
/** A calendar date (UTC midnight) n days from today, like checklist due dates. */
const dayUtc = (n: number) => {
  const d = inDays(n);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.error("Database already has users. seed-demo only runs on an empty database.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const people = [
    { username: "admin", displayName: "Ada Admin", role: "admin" },
    { username: "marta", displayName: "Marta Nowak", role: "member" },
    { username: "tomek", displayName: "Tomek Wiśniewski", role: "member" },
    { username: "julia", displayName: "Julia Kowalczyk", role: "member" },
    { username: "piotr", displayName: "Piotr Zieliński", role: "member" },
  ];
  const users = Object.fromEntries(
    await Promise.all(
      people.map(async (p) => [p.username, await prisma.user.create({ data: { ...p, passwordHash } })] as const)
    )
  );

  const product = await prisma.boardCategory.create({ data: { name: "Product", color: "#2563eb", position: 0 } });
  const ops = await prisma.boardCategory.create({ data: { name: "Operations", color: "#16a34a", position: 1 } });

  const board = await prisma.board.create({
    data: {
      name: "Website relaunch",
      description: "New marketing site, docs and onboarding flow.",
      color: "#2563eb",
      categoryId: product.id,
      position: 0,
      createdById: users.admin.id,
      members: {
        create: [
          { userId: users.admin.id, role: "owner" },
          { userId: users.marta.id, role: "owner" },
          { userId: users.tomek.id },
          { userId: users.julia.id },
          { userId: users.piotr.id },
        ],
      },
      tags: {
        create: [
          { name: "Design", color: "#db2777", position: 0 },
          { name: "Frontend", color: "#2563eb", position: 1 },
          { name: "Backend", color: "#7c3aed", position: 2 },
          { name: "Content", color: "#ea580c", position: 3 },
          { name: "Bug", color: "#dc2626", position: 4 },
        ],
      },
    },
    include: { tags: true },
  });
  const tag = Object.fromEntries(board.tags.map((t) => [t.name, t.id]));

  const columns = await Promise.all(
    [
      { name: "Backlog", wipLimit: null },
      { name: "To do", wipLimit: null },
      { name: "In progress", wipLimit: 3 },
      { name: "Review", wipLimit: 2 },
      { name: "Done", wipLimit: null },
    ].map((c, position) => prisma.boardColumn.create({ data: { ...c, boardId: board.id, position } }))
  );

  type Seed = {
    title: string;
    col: number;
    priority?: string;
    tags?: string[];
    who?: string[];
    due?: number;
    cover?: string;
    description?: string;
    /** Title, done, and optionally an assignee and a due date (days from today). */
    subtasks?: [string, boolean, string?, number?][];
    comments?: [string, string][];
  };
  const cards: Seed[] = [
    { title: "Audit current analytics events", col: 0, priority: "low", tags: ["Backend"] },
    { title: "Pricing page FAQ copy", col: 0, tags: ["Content"], who: ["julia"] },
    { title: "Dark mode for docs", col: 0, priority: "low", tags: ["Frontend", "Design"] },
    {
      title: "Hero section illustrations",
      col: 1,
      priority: "high",
      tags: ["Design"],
      who: ["marta"],
      due: 5,
      cover: "#db2777",
    },
    { title: "Newsletter signup endpoint", col: 1, tags: ["Backend"], who: ["piotr"], due: 9 },
    {
      title: "Responsive navigation",
      col: 2,
      priority: "high",
      tags: ["Frontend"],
      who: ["tomek"],
      due: 2,
      description:
        "Hamburger menu below **768px**, keep the CTA visible.\n\n- focus trap in the drawer\n- close on `Esc`\n- respect `prefers-reduced-motion`",
      subtasks: [
        ["Drawer component", true],
        ["Focus trap", true],
        ["Reduced motion", false, "marta", 1],
        ["Visual QA on iOS", false, "julia", 3],
      ],
      comments: [
        ["marta", "Designs are in the Figma file, page *Navigation v2*."],
        ["tomek", "Thanks @marta. Drawer is done, working on the focus trap now."],
      ],
    },
    {
      title: "Migrate blog to MDX",
      col: 2,
      tags: ["Frontend", "Content"],
      who: ["julia", "tomek"],
      due: 7,
      subtasks: [
        ["Export old posts", true],
        ["Convert embeds", false, "julia", 4],
      ],
    },
    {
      title: "Contact form spam protection",
      col: 2,
      priority: "critical",
      tags: ["Backend", "Bug"],
      who: ["piotr"],
      due: -1,
      cover: "#dc2626",
    },
    { title: "Lighthouse pass on landing page", col: 3, tags: ["Frontend"], who: ["tomek"], due: 3 },
    { title: "Brand color tokens", col: 3, priority: "high", tags: ["Design"], who: ["marta"] },
    { title: "Set up preview deployments", col: 4, tags: ["Backend"], who: ["piotr"] },
    { title: "Sitemap and robots.txt", col: 4, priority: "low", tags: ["Frontend"], who: ["tomek"] },
    { title: "Kickoff workshop notes", col: 4, tags: ["Content"], who: ["marta", "julia"] },
  ];

  const positions = new Map<number, number>();
  const created: Record<string, string> = {};
  for (const [index, c] of cards.entries()) {
    const position = positions.get(c.col) ?? 0;
    positions.set(c.col, position + 1);
    // Cards were added over the last two weeks and worked through the
    // columns since, which the card history (CardActivity) tells.
    const createdAt = new Date(Date.now() - (14 - index) * DAY);
    const doer = users[c.who?.[0] ?? "admin"];
    const card = await prisma.taskCard.create({
      data: {
        columnId: columns[c.col].id,
        title: c.title,
        description: c.description,
        position,
        priority: c.priority ?? "normal",
        coverColor: c.cover,
        deadline: c.due === undefined ? null : inDays(c.due),
        createdAt,
        createdById: users.admin.id,
        assignees: { create: (c.who ?? []).map((u) => ({ userId: users[u].id })) },
        tags: { create: (c.tags ?? []).map((t) => ({ tagId: tag[t] })) },
        subtasks: {
          create: (c.subtasks ?? []).map(([title, done, who, due], i) => ({
            title,
            done,
            position: i,
            completedAt: done ? new Date() : null,
            completedById: done ? doer.id : null,
            assigneeId: who ? users[who].id : null,
            dueDate: due === undefined ? null : dayUtc(due),
          })),
        },
        comments: {
          create: (c.comments ?? []).map(([author, body]) => ({ authorId: users[author].id, body })),
        },
        // The creator and the assignees follow the card, as in the app.
        watchers: {
          create: [...new Set(["admin", ...(c.who ?? [])])].map((u) => ({ userId: users[u].id })),
        },
      },
    });
    created[c.title] = card.id;

    const startCol = Math.min(c.col, 1);
    const at = (hours: number) => new Date(createdAt.getTime() + hours * HOUR);
    const history: { type: string; data: Record<string, unknown>; actorId: string; createdAt: Date }[] = [
      { type: "created", data: { column: columns[startCol].name }, actorId: users.admin.id, createdAt: at(0) },
      ...(c.who ?? []).map((u) => ({
        type: "assigneeAdded",
        data: { name: users[u].displayName },
        actorId: users.admin.id,
        createdAt: at(1),
      })),
    ];
    if (c.priority === "high" || c.priority === "critical") {
      history.push({ type: "priority", data: { from: "normal", to: c.priority }, actorId: users.admin.id, createdAt: at(2) });
    }
    if (c.due !== undefined) {
      history.push({ type: "deadline", data: { to: inDays(c.due).toISOString() }, actorId: users.admin.id, createdAt: at(3) });
    }
    for (let col = startCol + 1; col <= c.col; col++) {
      history.push({
        type: "moved",
        data: { from: columns[col - 1].name, to: columns[col].name },
        actorId: doer.id,
        createdAt: at(24 * (col - startCol)),
      });
    }
    for (const [title, done] of c.subtasks ?? []) {
      if (done) history.push({ type: "subtaskDone", data: { title }, actorId: doer.id, createdAt: at(30) });
    }
    await prisma.cardActivity.createMany({
      data: history.map((h) => ({ ...h, cardId: card.id, boardId: board.id, data: JSON.stringify(h.data) })),
    });
    await prisma.taskCardMoveEvent.create({
      data: {
        cardId: card.id,
        cardTitle: card.title,
        boardId: board.id,
        toColumnName: columns[c.col].name,
        userId: users[c.who?.[0] ?? "admin"].id,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 120) * DAY),
      },
    });
  }

  await prisma.taskBlock.create({
    data: {
      blockerId: created["Contact form spam protection"],
      blockedId: created["Newsletter signup endpoint"],
      createdById: users.piotr.id,
    },
  });
  await prisma.cardActivity.create({
    data: {
      cardId: created["Newsletter signup endpoint"],
      boardId: board.id,
      type: "blocked",
      data: JSON.stringify({ title: "Contact form spam protection" }),
      actorId: users.piotr.id,
    },
  });

  // Card templates and a repeating schedule, so "New card from template" and
  // Settings > Repeat have something to show.
  await prisma.cardTemplate.create({
    data: {
      boardId: board.id,
      name: "Bug triage",
      title: "Bug: ",
      description: "**Steps to reproduce**\n\n1. \n\n**Expected**\n\n**Actual**",
      priority: "high",
      tagIds: JSON.stringify([tag.Bug]),
      checklist: JSON.stringify(["Reproduce", "Write a failing test", "Fix", "Verify on staging"]),
      createdById: users.piotr.id,
    },
  });
  const weekly = await prisma.cardTemplate.create({
    data: {
      boardId: board.id,
      name: "Weekly analytics review",
      title: "Analytics review",
      description: "Look at last week's traffic and conversions, and note anything unusual.",
      tagIds: JSON.stringify([tag.Content]),
      checklist: JSON.stringify(["Traffic and sources", "Signup conversion"]),
      createdById: users.julia.id,
    },
  });
  const rule = { rule: "weekly" as const, weekday: 1, timeOfDay: "09:00" };
  await prisma.cardRecurrence.create({
    data: {
      boardId: board.id,
      templateId: weekly.id,
      columnId: columns[1].id,
      rule: rule.rule,
      weekday: rule.weekday,
      timeOfDay: rule.timeOfDay,
      nextRunAt: nextOccurrence(rule, new Date()),
      createdById: users.julia.id,
    },
  });

  const extraBoards = [
    { name: "Mobile app", color: "#7c3aed", categoryId: product.id, position: 1 },
    { name: "Customer support", color: "#ea580c", categoryId: ops.id, position: 0 },
    { name: "Hiring", color: "#16a34a", categoryId: ops.id, position: 1 },
  ];
  for (const b of extraBoards) {
    await prisma.board.create({
      data: {
        ...b,
        createdById: users.admin.id,
        members: { create: [{ userId: users.admin.id, role: "owner" }, { userId: users.marta.id }] },
        columns: {
          create: ["To do", "Doing", "Done"].map((name, position) => ({ name, position })),
        },
      },
    });
  }

  console.log("Demo workspace created. Log in as admin / demo1234 (or marta, tomek, julia, piotr).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
