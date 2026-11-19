export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isPostgres } = await import("@/lib/db-provider");
  const { attachmentStorage } = await import("@/server/attachment-storage");
  let storage: ReturnType<typeof attachmentStorage> | null = null;
  try {
    storage = attachmentStorage();
  } catch (err) {
    // Uploads and downloads fail until this is fixed; say so at startup.
    console.error(`[kanbun] Attachment storage is misconfigured: ${(err as Error).message} (see README.md).`);
  }
  if (storage?.kind === "s3") {
    const keys = storage.s3.accessKeyId ? "static keys" : "credentials from the AWS environment or an IAM role";
    console.info(`[kanbun] Attachments are stored in S3 bucket ${storage.s3.bucket} (${keys}).`);
  } else if (storage && isPostgres() && !process.env.ATTACHMENTS_DIR?.trim()) {
    // With SQLite, attachments default to a folder next to the database file.
    // There is no such place for PostgreSQL, and several instances must share it.
    console.warn(
      "[kanbun] DATABASE_URL is PostgreSQL but ATTACHMENTS_DIR is not set: attachments go to prisma/attachments inside this instance. Point ATTACHMENTS_DIR at a persistent volume shared by every instance, or use S3 (ATTACHMENTS_S3_BUCKET, see docs/SCALING.md).",
    );
  }
  const { startJobs } = await import("@/server/jobs");
  startJobs();
}
