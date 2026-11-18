import { prisma } from "../src/lib/db-local";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function ask(rl: ReturnType<typeof createInterface>, q: string, fallback?: string) {
  const answer = (await rl.question(q)).trim();
  if (!answer && fallback !== undefined) return fallback;
  return answer;
}

async function main() {
  const rl = createInterface({ input, output });
  try {
    const username = (await ask(rl, "Admin username [admin]: ", "admin")).toLowerCase();
    const displayName = await ask(rl, `Display name [${username}]: `, username);
    const password = await ask(rl, "Password: ");
    if (!password) {
      console.error("Password is required.");
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      // Break-glass recovery for a lost authenticator: clear the 2FA setup too.
      const reset2fa =
        !!existing.totpEnabledAt &&
        /^y(es)?$/i.test(await ask(rl, "This user has two-factor authentication on. Turn it off? [y/N]: ", "n"));
      await prisma.user.update({
        where: { username },
        data: {
          passwordHash,
          displayName,
          role: "admin",
          sessionVersion: { increment: 1 },
          ...(reset2fa ? { totpSecret: null, totpEnabledAt: null, totpLastStep: null } : {}),
        },
      });
      if (reset2fa) await prisma.totpRecoveryCode.deleteMany({ where: { userId: existing.id } });
      console.log(`Updated existing user '${username}' to admin${reset2fa ? " and turned off two-factor authentication" : ""}.`);
    } else {
      await prisma.user.create({
        data: {
          username,
          passwordHash,
          displayName,
          role: "admin",
        },
      });
      console.log(`Created admin user '${username}'.`);
    }
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
