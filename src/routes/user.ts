import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
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

user.get('/stats', async (c) => {
  const userId = c.get('userId')
  const [completedModules, totalModules, watchlistCount, alertCount] = await Promise.all([
    db.userModuleProgress.count({ where: { userId, status: 'completed' } }),
    db.module.count({ where: { isPublished: true } }),
    db.watchlistItem.count({ where: { userId } }),
    db.priceAlert.count({ where: { userId, isActive: true } }),
  ])
  return c.json({ data: { completedModules, totalModules, watchlistCount, alertCount } })
})

export default user
