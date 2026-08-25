import { toEAT } from '@habexa/sdk'
import { db } from './db.js'

function eatDateOnly(d: Date): string {
  const eat = toEAT(d)
  return eat.toISOString().slice(0, 10) // YYYY-MM-DD in EAT
}

/**
 * Call on any activity that should count toward the daily streak (login,
 * module progress, a placed trade). Idempotent per calendar day in EAT.
 * Returns the user's streak state after the update.
 */
export async function touchStreak(userId: string): Promise<{ currentStreak: number; longestStreak: number }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { currentStreak: true, longestStreak: true, lastActiveDate: true },
  })

  const today = eatDateOnly(new Date())
  const lastActive = user.lastActiveDate ? eatDateOnly(user.lastActiveDate) : null

  if (lastActive === today) {
    // Already counted today — no change.
    return { currentStreak: user.currentStreak, longestStreak: user.longestStreak }
  }

  const yesterday = eatDateOnly(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const continuesStreak = lastActive === yesterday
  const currentStreak = continuesStreak ? user.currentStreak + 1 : 1
  const longestStreak = Math.max(user.longestStreak, currentStreak)

  await db.user.update({
    where: { id: userId },
    data: { currentStreak, longestStreak, lastActiveDate: new Date() },
  })

  return { currentStreak, longestStreak }
}
