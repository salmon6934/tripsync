import { eq, isNull } from 'drizzle-orm';
import { pickAvatarIdForSeed } from '@tripsync/shared';

import { db, client } from '../db/index.js';
import { users } from '../db/schema.js';

/**
 * Backfills `users.avatar_id` for accounts created before the avatar-id
 * migration (their old `avatar_url` data URIs were dropped, leaving avatar_id
 * NULL). Assigns a stable default derived from the email via
 * `pickAvatarIdForSeed`, matching what signup does for form-less accounts.
 *
 * Idempotent: only rows with a NULL avatar_id are touched, so it is safe to
 * run more than once.
 *
 * Usage: dotenv -e ../../.env -- tsx src/scripts/backfill-avatar-ids.ts
 */
async function main() {
  const pending = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNull(users.avatarId));

  if (pending.length === 0) {
    console.log('No users need an avatar backfill.');
    return;
  }

  console.log(`Backfilling avatar ids for ${pending.length} user(s)...`);

  for (const user of pending) {
    const avatarId = pickAvatarIdForSeed(user.email.toLowerCase());
    await db.update(users).set({ avatarId }).where(eq(users.id, user.id));
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Avatar backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
