import { prisma } from '../db.js';

/** In-app notification to a specific user or to every user holding a role. */
export async function notify({ userId, role, title, message, link }, tx = prisma) {
  await tx.notification.create({
    data: { userId: userId ?? null, role: role ?? null, title, message, link: link ?? null },
  });
}

