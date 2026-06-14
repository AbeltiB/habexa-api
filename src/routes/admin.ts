import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { adminMiddleware } from '../middleware/admin.js'
import { db } from '../lib/db.js'
import { sendPushNotification } from '../lib/push.js'

const admin = new Hono<{ Variables: AuthVariables }>()

admin.use('*', authMiddleware, adminMiddleware)

// ── Dashboard ─────────────────────────────────────────────────────────────────

admin.get('/dashboard', async (c) => {
  const [totalUsers, premiumUsers, totalModules, pendingSubs] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { isPremium: true } }),
    db.module.count(),
    db.subscription.count({ where: { status: 'pending' } }),
  ])
  return c.json({ data: { totalUsers, premiumUsers, totalModules, pendingSubs } })
})

// ── Users ─────────────────────────────────────────────────────────────────────

admin.get('/users', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const search = c.req.query('search') ?? ''
  const isPremiumFilter = c.req.query('isPremium')

  const where = {
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
          ],
        }
      : {}),
    ...(isPremiumFilter !== undefined ? { isPremium: isPremiumFilter === 'true' } : {}),
  }

  const [users, total] = await Promise.all([
    db.user.findMany({ where, skip: (page - 1) * 20, take: 20, orderBy: { createdAt: 'desc' } }),
    db.user.count({ where }),
  ])

  return c.json({ data: { users, total, page } })
})

admin.get('/users/:id', async (c) => {
  const user = await db.user.findUnique({
    where: { id: c.req.param('id') },
    include: { subscription: true, paperAccount: true },
  })
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json({ data: user })
})

// ── Modules ───────────────────────────────────────────────────────────────────

const moduleSchema = z.object({
  slug: z.string().min(1),
  titleAm: z.string().min(1),
  titleEn: z.string().min(1),
  descriptionAm: z.string().optional(),
  descriptionEn: z.string().optional(),
  type: z.enum(['video', 'article', 'quiz']),
  track: z.enum(['foundation', 'intermediate', 'advanced']),
  orderIndex: z.number().int().nonnegative(),
  isPremium: z.boolean().default(false),
  durationMin: z.number().int().positive().optional(),
  videoUrl: z.string().url().optional(),
  contentAm: z.string().optional(),
  contentEn: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
})

admin.get('/modules', async (c) => {
  const mods = await db.module.findMany({
    orderBy: [{ track: 'asc' }, { orderIndex: 'asc' }],
    include: { _count: { select: { quizQuestions: true } } },
  })
  return c.json({ data: mods })
})

admin.post('/modules', zValidator('json', moduleSchema), async (c) => {
  const mod = await db.module.create({ data: c.req.valid('json') })
  return c.json({ data: mod }, 201)
})

admin.put('/modules/:id', zValidator('json', moduleSchema.partial()), async (c) => {
  const mod = await db.module.update({
    where: { id: c.req.param('id') },
    data: c.req.valid('json'),
  })
  return c.json({ data: mod })
})

admin.delete('/modules/:id', async (c) => {
  await db.module.delete({ where: { id: c.req.param('id') } })
  return c.json({ data: { success: true } })
})

admin.post('/modules/:id/publish', async (c) => {
  const mod = await db.module.update({
    where: { id: c.req.param('id') },
    data: { isPublished: true },
  })
  return c.json({ data: mod })
})

admin.post('/modules/:id/unpublish', async (c) => {
  const mod = await db.module.update({
    where: { id: c.req.param('id') },
    data: { isPublished: false },
  })
  return c.json({ data: mod })
})

// ── Prices ────────────────────────────────────────────────────────────────────

const priceRowSchema = z.object({
  symbol: z.string().min(1),
  nameEn: z.string().min(1),
  nameAm: z.string().min(1),
  sector: z.string().optional(),
  currentPrice: z.number().int().positive(),
  previousClose: z.number().int().positive(),
  openPrice: z.number().int().positive().optional(),
  dayHigh: z.number().int().positive().optional(),
  dayLow: z.number().int().positive().optional(),
  volume: z.number().int().nonnegative().optional(),
  tradingDate: z.string(),
})

const priceUpdateSchema = z.array(priceRowSchema)

function buildPriceUpsert(u: z.infer<typeof priceRowSchema>, tradingDate: Date) {
  return db.stockPrice.upsert({
    where: { symbol_tradingDate: { symbol: u.symbol, tradingDate } },
    create: {
      symbol: u.symbol,
      nameEn: u.nameEn,
      nameAm: u.nameAm,
      sector: u.sector,
      currentPrice: BigInt(u.currentPrice),
      previousClose: BigInt(u.previousClose),
      openPrice: u.openPrice != null ? BigInt(u.openPrice) : null,
      dayHigh: u.dayHigh != null ? BigInt(u.dayHigh) : null,
      dayLow: u.dayLow != null ? BigInt(u.dayLow) : null,
      volume: BigInt(u.volume ?? 0),
      tradingDate,
    },
    update: {
      nameEn: u.nameEn,
      nameAm: u.nameAm,
      currentPrice: BigInt(u.currentPrice),
      previousClose: BigInt(u.previousClose),
      openPrice: u.openPrice != null ? BigInt(u.openPrice) : null,
      dayHigh: u.dayHigh != null ? BigInt(u.dayHigh) : null,
      dayLow: u.dayLow != null ? BigInt(u.dayLow) : null,
      volume: BigInt(u.volume ?? 0),
    },
  })
}

admin.get('/prices', async (c) => {
  const stocks = await db.stockPrice.findMany({
    orderBy: { updatedAt: 'desc' },
    distinct: ['symbol'],
  })
  return c.json({ data: stocks })
})

admin.put('/prices', zValidator('json', priceUpdateSchema), async (c) => {
  const updates = c.req.valid('json')
  const tradingDate = new Date(updates[0].tradingDate)
  const results = await db.$transaction(updates.map(u => buildPriceUpsert(u, tradingDate)))
  return c.json({ data: { updated: results.length } })
})

admin.post('/prices/csv', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const text = await file.text()
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return c.json({ error: 'CSV must have a header row and at least one data row' }, 400)

  const headers = lines[0].split(',').map(h => h.trim())
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim())
    return headers.reduce<Record<string, string>>((obj, h, i) => ({ ...obj, [h]: vals[i] ?? '' }), {})
  })

  const parsed = priceUpdateSchema.safeParse(
    rows.map(r => ({
      ...r,
      currentPrice: Number(r.currentPrice),
      previousClose: Number(r.previousClose),
      openPrice: r.openPrice ? Number(r.openPrice) : undefined,
      dayHigh: r.dayHigh ? Number(r.dayHigh) : undefined,
      dayLow: r.dayLow ? Number(r.dayLow) : undefined,
      volume: r.volume ? Number(r.volume) : undefined,
    })),
  )
  if (!parsed.success) return c.json({ error: 'Invalid CSV data', details: parsed.error.flatten() }, 400)

  const tradingDate = new Date(parsed.data[0].tradingDate)
  const results = await db.$transaction(parsed.data.map(u => buildPriceUpsert(u, tradingDate)))
  return c.json({ data: { updated: results.length } })
})

// ── Subscriptions ─────────────────────────────────────────────────────────────

admin.get('/subscriptions', async (c) => {
  const status = c.req.query('status')
  const subs = await db.subscription.findMany({
    where: status ? { status } : undefined,
    include: { user: { select: { displayName: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return c.json({ data: subs })
})

admin.post('/subscriptions/:id/confirm', async (c) => {
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: c.req.param('id') } })
  await db.$transaction([
    db.subscription.update({ where: { id: sub.id }, data: { status: 'active' } }),
    db.user.update({ where: { id: sub.userId }, data: { isPremium: true } }),
  ])
  return c.json({ data: { success: true } })
})

admin.post('/subscriptions/:id/reject', async (c) => {
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: c.req.param('id') } })
  await db.$transaction([
    db.subscription.update({ where: { id: sub.id }, data: { status: 'rejected' } }),
    db.user.update({ where: { id: sub.userId }, data: { isPremium: false } }),
  ])
  return c.json({ data: { success: true } })
})

// ── Push notifications ────────────────────────────────────────────────────────

const broadcastSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  url: z.string().url().optional(),
  segment: z.enum(['all', 'premium', 'free']).default('all'),
})

admin.post('/push/broadcast', zValidator('json', broadcastSchema), async (c) => {
  const { title, body, url, segment } = c.req.valid('json')

  const userFilter =
    segment === 'premium' ? { isPremium: true } :
    segment === 'free' ? { isPremium: false } :
    undefined

  const subs = await db.pushSubscription.findMany({
    where: userFilter ? { user: userFilter } : undefined,
  })

  let sent = 0
  let failed = 0

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await sendPushNotification({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, { title, body, url })
        sent++
      } catch {
        failed++
      }
    }),
  )

  return c.json({ data: { sent, failed, total: subs.length } })
})

admin.get('/push/history', async (c) => {
  return c.json({ data: [] })
})

export default admin
