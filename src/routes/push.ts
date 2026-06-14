import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const push = new Hono<{ Variables: AuthVariables }>()

push.use('*', authMiddleware)

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
})

push.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const userId = c.get('userId')
  const { endpoint, p256dh, auth } = c.req.valid('json')

  const sub = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh, auth },
    update: { userId, p256dh, auth },
  })

  return c.json({ data: sub }, 201)
})

push.delete('/subscribe', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({})) as { endpoint?: string }

  if (body.endpoint) {
    await db.pushSubscription.deleteMany({ where: { userId, endpoint: body.endpoint } })
  } else {
    await db.pushSubscription.deleteMany({ where: { userId } })
  }

  return c.json({ data: { success: true } })
})

export default push
