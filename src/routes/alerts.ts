import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const alerts = new Hono<{ Variables: AuthVariables }>()

alerts.use('*', authMiddleware)

const createAlertSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  condition: z.enum(['above', 'below']),
  targetPrice: z.number().positive(),
})

alerts.get('/', async (c) => {
  const items = await db.priceAlert.findMany({
    where: { userId: c.get('userId') },
    orderBy: { createdAt: 'desc' },
  })
  return c.json({ data: items })
})

alerts.post('/', zValidator('json', createAlertSchema), async (c) => {
  const userId = c.get('userId')
  const { symbol, condition, targetPrice } = c.req.valid('json')

  const stock = await db.stockPrice.findFirst({ where: { symbol } })
  if (!stock) return c.json({ error: 'Stock not found' }, 404)

  const alert = await db.priceAlert.create({
    data: { userId, symbol, condition, targetPrice: BigInt(Math.round(targetPrice)) },
  })

  return c.json({ data: alert }, 201)
})

alerts.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const alert = await db.priceAlert.findFirst({ where: { id, userId } })
  if (!alert) return c.json({ error: 'Alert not found' }, 404)

  await db.priceAlert.delete({ where: { id } })
  return c.json({ data: { success: true } })
})

export default alerts
