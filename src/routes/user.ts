import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ApplyReferralSchema } from '@habexa/sdk'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const user = new Hono<{ Variables: AuthVariables }>()

user.use('*', authMiddleware)

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  language: z.enum(['am', 'en']).optional(),
  avatarUrl: z.string().url().optional(),
})

const onboardingSchema = z.object({
  displayName: z.string().min(1).max(100),
  language: z.enum(['am', 'en']),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  goal: z.string().min(1).max(500),
})


user.get('/me', async (c) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: c.get('userId') } })
  return c.json({ data: u })
})

user.put('/me', zValidator('json', updateUserSchema), async (c) => {
  const u = await db.user.update({
    where: { id: c.get('userId') },
    data: c.req.valid('json'),
  })
  return c.json({ data: u })
})

user.post('/onboarding', zValidator('json', onboardingSchema), async (c) => {
  const u = await db.user.update({
    where: { id: c.get('userId') },
    data: c.req.valid('json'),
  })
  return c.json({ data: u })
})

// One-shot: applies a referral code the user was given by someone else.
// A no-op if they already have a referrer, entered their own code, or the
// code doesn't match anyone — kept generic (not tied to a specific auth
// method) so it works the same after phone, Telegram, or Google signup.
user.post('/apply-referral', zValidator('json', ApplyReferralSchema), async (c) => {
  const userId = c.get('userId')
  const { code } = c.req.valid('json')

  const me = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (me.referredById) {
    return c.json({ error: 'A referral code was already applied to this account', code: 'VALIDATION_ERROR' }, 409)
  }
  if (me.referralCode.toUpperCase() === code.toUpperCase()) {
    return c.json({ error: "You can't use your own referral code", code: 'VALIDATION_ERROR' }, 400)
  }

  const referrer = await db.user.findFirst({ where: { referralCode: code.toUpperCase() } })
  if (!referrer) return c.json({ error: 'Referral code not found', code: 'VALIDATION_ERROR' }, 404)

  const updated = await db.user.update({ where: { id: userId }, data: { referredById: referrer.id } })
  return c.json({ data: updated })
})

user.get('/stats', async (c) => {
  const userId = c.get('userId')
  const [completedModules, totalModules, watchlistCount, alertCount, tradesPlaced, me] = await Promise.all([
    db.userModuleProgress.count({ where: { userId, status: 'completed' } }),
    db.module.count({ where: { isPublished: true } }),
    db.watchlistItem.count({ where: { userId } }),
    db.priceAlert.count({ where: { userId, isActive: true } }),
    db.paperTrade.count({ where: { account: { userId } } }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { currentStreak: true, longestStreak: true } }),
  ])
  return c.json({
    data: {
      completedModules, totalModules, watchlistCount, alertCount, tradesPlaced,
      currentStreak: me.currentStreak,
      longestStreak: me.longestStreak,
    },
  })
})

user.get('/badges', async (c) => {
  const userId = c.get('userId')
  const earned = await db.userBadge.findMany({
    where: { userId },
    include: { badge: true },
    orderBy: { earnedAt: 'desc' },
  })
  return c.json({ data: earned })
})

export default user
