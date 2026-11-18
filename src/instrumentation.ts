export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isPostgres } = await import("@/lib/db-provider");
  if (isPostgres() && !process.env.ATTACHMENTS_DIR?.trim()) {
    // With SQLite, attachments default to a folder next to the database file.
    // There is no such place for PostgreSQL, and several instances must share it.
    console.warn(
      "[kanbun] DATABASE_URL is PostgreSQL but ATTACHMENTS_DIR is not set: attachments go to prisma/attachments inside this instance. Point ATTACHMENTS_DIR at a persistent volume shared by every instance (docs/SCALING.md).",
    );
  }
  const { startJobs } = await import("@/server/jobs");
  startJobs();
}
