import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { PLAN_PRICES } from '@habexa/sdk'
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

function buildInstructions(plan: 'monthly' | 'annual'): string {
  const etb = (PLAN_PRICES[plan] / 100).toFixed(2)
  const bankName = process.env.BANK_NAME
  const accountName = process.env.BANK_ACCOUNT_NAME
  const accountNumber = process.env.BANK_ACCOUNT_NUMBER

  if (!bankName || !accountName || !accountNumber) {
    return `Transfer ETB ${etb} to the Habexa bank account (contact support for details), then submit the transaction reference below. An admin will confirm within 24 hours.`
  }
  return `Transfer ETB ${etb} to ${bankName}, account name "${accountName}", account number ${accountNumber}. Then submit the transaction reference below — an admin will confirm within 24 hours.`
}

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

  return c.json({ data: { ...sub, instructions: buildInstructions(plan) } }, 201)
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
