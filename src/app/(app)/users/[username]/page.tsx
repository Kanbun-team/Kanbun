import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/components/Avatar";
import DeviceIcon from "@/components/DeviceIcon";
import Heatmap from "@/components/Heatmap";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t, formatDateTime } from "@/lib/i18n";
import { isOnline, ONLINE_WINDOW_MS, type DeviceType } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const session = await auth();
  const me = session?.user;
  const locale = await getLocale();

  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) notFound();

  const lastSession = await prisma.userSession.findFirst({
    where: { userId: user.id },
    orderBy: { lastSeenAt: "desc" },
  });

  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);

  const [counters, assignedNow, latestMoves, latestComments, moves365, comments365, subs365] = await Promise.all([
    Promise.all([
      prisma.taskCardAssignee.count({ where: { userId: user.id } }),
      prisma.taskCardComment.count({ where: { authorId: user.id } }),
      prisma.taskCardMoveEvent.count({ where: { userId: user.id } }),
      prisma.taskSubtask.count({ where: { completedById: user.id } }),
    ]),
    prisma.taskCardAssignee.findMany({
      where: { userId: user.id },
      take: 10,
      orderBy: { card: { updatedAt: "desc" } },
      include: {
        card: {
          select: {
            id: true,
            title: true,
            priority: true,
            column: { select: { boardId: true, name: true, board: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.taskCardMoveEvent.findMany({
      where: { userId: user.id },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.taskCardComment.findMany({
      where: { authorId: user.id },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { card: { select: { id: true, title: true, column: { select: { boardId: true } } } } },
    }),
    prisma.taskCardMoveEvent.findMany({
      where: { userId: user.id, createdAt: { gte: oneYearAgo } },
      select: { createdAt: true },
    }),
    prisma.taskCardComment.findMany({
      where: { authorId: user.id, createdAt: { gte: oneYearAgo } },
      select: { createdAt: true },
    }),
    prisma.taskSubtask.findMany({
      where: { completedById: user.id, completedAt: { gte: oneYearAgo, not: null } },
      select: { completedAt: true },
    }),
  ]);

  const [assignedCount, commentsCount, movesCount, subtasksCount] = counters;

  const buckets = new Map<string, { date: string; total: number; moves: number; comments: number; subtasks: number }>();
  function add(date: Date, kind: "moves" | "comments" | "subtasks") {
    const key = date.toISOString().slice(0, 10);
    let b = buckets.get(key);
    if (!b) {
      b = { date: key, total: 0, moves: 0, comments: 0, subtasks: 0 };
      buckets.set(key, b);
    }
    b[kind] += 1;
    b.total += 1;
  }
  moves365.forEach((m) => add(m.createdAt, "moves"));
  comments365.forEach((c) => add(c.createdAt, "comments"));
  subs365.forEach((s) => s.completedAt && add(s.completedAt, "subtasks"));

  const isSelf = me?.id === user.id;
  const isAdmin = me?.role === "admin";
  const showSessions = isSelf || isAdmin;

  const activeSessions = showSessions
    ? await prisma.userSession.findMany({
        where: {
          userId: user.id,
          lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) },
        },
        orderBy: { lastSeenAt: "desc" },
      })
    : [];
  const recentSessions = showSessions
    ? await prisma.userSession.findMany({
        where: { userId: user.id },
        orderBy: { lastSeenAt: "desc" },
        take: 10,
      })
    : [];

  const online = isOnline(lastSession?.lastSeenAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <Avatar src={user.avatarUrl} name={user.displayName ?? user.username} size={64} online={online} />
        <div>
          <h1 className="text-xl font-semibold">{user.displayName ?? user.username}</h1>
          <div className="text-sm opacity-70">@{user.username}</div>
          <div className="text-xs opacity-60">
            {online ? t("online", locale) : `${t("lastSeen", locale)}: ${lastSession ? formatDateTime(lastSession.lastSeenAt, locale) : t("none", locale)}`}
          </div>
        </div>
      </div>

      <section className="grid sm:grid-cols-4 gap-3">
        <Counter label={t("cardsCount", locale)} value={assignedCount} />
        <Counter label={t("commentsCount", locale)} value={commentsCount} />
        <Counter label={t("movesCount", locale)} value={movesCount} />
        <Counter label={t("subtasksCount", locale)} value={subtasksCount} />
      </section>

      <section className="surface border rounded-xl p-4">
        <h2 className="text-sm uppercase tracking-wide opacity-60 mb-3">{t("profileHeatmap", locale)}</h2>
        <Heatmap
          startDate={oneYearAgo}
          endDate={new Date()}
          buckets={Array.from(buckets.values())}
          locale={locale}
        />
      </section>

      <section className="surface border rounded-xl p-4">
        <h2 className="text-sm uppercase tracking-wide opacity-60 mb-3">{t("profileAssignedNow", locale)}</h2>
        {assignedNow.length === 0 ? (
          <p className="text-sm opacity-60">{t("none", locale)}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {assignedNow.map((a) => (
              <li key={a.cardId} className="flex items-center justify-between gap-2">
                <Link
                  href={`/tasks/${a.card.column.boardId}/cards/${a.card.id}`}
                  className="hover:underline truncate"
                >
                  {a.card.title}
                </Link>
                <span className="text-xs opacity-60 shrink-0">
                  {a.card.column.board.name} / {a.card.column.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid sm:grid-cols-2 gap-4">
        <section className="surface border rounded-xl p-4">
          <h2 className="text-sm uppercase tracking-wide opacity-60 mb-3">{t("profileLatestMoves", locale)}</h2>
          {latestMoves.length === 0 ? (
            <p className="text-sm opacity-60">{t("none", locale)}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {latestMoves.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/tasks/${m.boardId}/cards/${m.cardId}`}
                    className="hover:underline truncate block"
                  >
                    {m.cardTitle}
                  </Link>
                  <div className="text-xs opacity-60">
                    {m.fromColumnName ? `${m.fromColumnName} -> ` : ""}{m.toColumnName} - {formatDateTime(m.createdAt, locale)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface border rounded-xl p-4">
          <h2 className="text-sm uppercase tracking-wide opacity-60 mb-3">{t("profileLatestComments", locale)}</h2>
          {latestComments.length === 0 ? (
            <p className="text-sm opacity-60">{t("none", locale)}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {latestComments.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/tasks/${c.card.column.boardId}/cards/${c.card.id}`}
                    className="hover:underline truncate block"
                  >
                    {c.card.title}
                  </Link>
                  <div className="text-xs opacity-60 line-clamp-2">{c.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {showSessions && (
        <div className="grid sm:grid-cols-2 gap-4">
          <SessionsList
            title={t("profileActiveSessions", locale)}
            sessions={activeSessions.map((s) => ({
              id: s.id,
              deviceType: s.deviceType as DeviceType,
              userAgent: s.userAgent,
              lastSeenAt: s.lastSeenAt.toISOString(),
            }))}
            locale={locale}
          />
          <SessionsList
            title={t("profileRecentSessions", locale)}
            sessions={recentSessions.map((s) => ({
              id: s.id,
              deviceType: s.deviceType as DeviceType,
              userAgent: s.userAgent,
              lastSeenAt: s.lastSeenAt.toISOString(),
            }))}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface border rounded-xl p-4">
      <div className="text-xs uppercase opacity-60">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function SessionsList({
  title,
  sessions,
  locale,
}: {
  title: string;
  sessions: { id: string; deviceType: DeviceType; userAgent: string | null; lastSeenAt: string }[];
  locale: import("@/lib/i18n").Locale;
}) {
  return (
    <section className="surface border rounded-xl p-4">
      <h2 className="text-sm uppercase tracking-wide opacity-60 mb-3">{title}</h2>
      {sessions.length === 0 ? (
        <p className="text-sm opacity-60">{t("none", locale)}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <DeviceIcon type={s.deviceType} />
              <span className="capitalize text-xs">
                {s.deviceType === "mobile"
                  ? t("profileSessionMobile", locale)
                  : s.deviceType === "desktop"
                  ? t("profileSessionDesktop", locale)
                  : t("profileSessionWeb", locale)}
              </span>
              <span className="text-xs opacity-60 ml-auto">{formatDateTime(new Date(s.lastSeenAt), locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
