import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const prisma = new PrismaClient();

async function ask(rl: ReturnType<typeof createInterface>, q: string, fallback?: string) {
  const answer = (await rl.question(q)).trim();
  if (!answer && fallback !== undefined) return fallback;
  return answer;
}

async function main() {
  const rl = createInterface({ input, output });
  try {
    const username = await ask(rl, "Admin username [admin]: ", "admin");
    const displayName = await ask(rl, `Display name [${username}]: `, username);
    const password = await ask(rl, "Password: ");
    if (!password) {
      console.error("Password is required.");
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      await prisma.user.update({
        where: { username },
        data: {
          passwordHash,
          displayName,
          role: "admin",
        },
      });
      console.log(`Updated existing user '${username}' to admin.`);
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
