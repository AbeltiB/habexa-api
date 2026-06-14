import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const subscription = new Hono<{ Variables: AuthVariables }>()

subscription.use('*', authMiddleware)

const initiateSchema = z.object({
  plan: z.enum(['monthly', 'annual']),
  paymentMethod: z.string().min(1),
})

subscription.get('/', async (c) => {
  const sub = await db.subscription.findUnique({ where: { userId: c.get('userId') } })
  return c.json({ data: sub })
})

subscription.post('/initiate', zValidator('json', initiateSchema), async (c) => {
  const userId = c.get('userId')
  const { plan, paymentMethod } = c.req.valid('json')
  const periodDays = plan === 'annual' ? 365 : 30
  const currentPeriodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000)

  const sub = await db.subscription.upsert({
    where: { userId },
    create: { userId, plan, paymentMethod, status: 'pending', currentPeriodEnd },
    update: { plan, paymentMethod, status: 'pending', currentPeriodEnd, cancelledAt: null },
  })

  return c.json({ data: sub }, 201)
})

subscription.delete('/', async (c) => {
  const userId = c.get('userId')
  const sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) return c.json({ error: 'No active subscription' }, 404)

  await db.subscription.update({
    where: { userId },
    data: { status: 'cancelled', cancelledAt: new Date() },
  })

  return c.json({ data: { success: true } })
})

export default subscription
