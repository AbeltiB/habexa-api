import { db } from './db.js'

export const BADGE_DEFINITIONS = {
  first_trade: {
    nameEn: 'First Trade', nameAm: 'የመጀመሪያ ግብይት',
    descriptionEn: 'Placed your first paper trade', descriptionAm: 'የመጀመሪያ ወረቀት ግብይትዎን አድርገዋል',
    icon: '📈',
  },
  first_module: {
    nameEn: 'First Steps', nameAm: 'የመጀመሪያ እርምጃዎች',
    descriptionEn: 'Completed your first module', descriptionAm: 'የመጀመሪያ ትምህርትዎን አጠናቀዋል',
    icon: '🎓',
  },
  streak_7: {
    nameEn: '7-Day Streak', nameAm: '7-ቀን ተከታታይ',
    descriptionEn: 'Stayed active for 7 days in a row', descriptionAm: 'ለ7 ተከታታይ ቀናት ንቁ ሆነዋል',
    icon: '🔥',
  },
} as const

export type BadgeKey = keyof typeof BADGE_DEFINITIONS

/** Idempotent — safe to call even if the user already has the badge. */
export async function awardBadge(userId: string, key: BadgeKey): Promise<boolean> {
  const def = BADGE_DEFINITIONS[key]
  const badge = await db.badge.upsert({
    where: { key },
    update: {},
    create: { key, ...def },
  })

  const existing = await db.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId: badge.id } },
  })
  if (existing) return false

  await db.userBadge.create({ data: { userId, badgeId: badge.id } })
  return true
}

export async function checkFirstTradeBadge(userId: string): Promise<void> {
  const tradeCount = await db.paperTrade.count({
    where: { account: { userId } },
  })
  if (tradeCount === 1) await awardBadge(userId, 'first_trade')
}

export async function checkFirstModuleBadge(userId: string): Promise<void> {
  const completedCount = await db.userModuleProgress.count({
    where: { userId, status: 'completed' },
  })
  if (completedCount === 1) await awardBadge(userId, 'first_module')
}

export async function checkStreakBadge(userId: string, currentStreak: number): Promise<void> {
  if (currentStreak >= 7) await awardBadge(userId, 'streak_7')
}
