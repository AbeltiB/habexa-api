import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { adminMiddleware } from '../middleware/admin.js'
import { db } from '../lib/db.js'
import { sendPushNotification } from '../lib/push.js'
import { sendAdminNotification } from '../lib/email.js'
import {
  uploadToImageKit,
  deleteFromImageKit,
  getImageKitAuthParams,
} from '../lib/imagekit.js'
import { uploadToYouTube, type YouTubeVisibility } from '../lib/youtube.js'
import { getAuthSettings, updateAuthSettings, AuthSettingsError } from '../lib/auth-settings.js'
import { UpdateAuthSettingsSchema, getLeaderboardWeekStart } from '@habexa/sdk'

const admin = new Hono()

admin.use('*', adminMiddleware)

// ── Dashboard ─────────────────────────────────────────────────────────────────

admin.get('/dashboard/stats', async (c) => {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  // D7 retention proxy: of users who signed up 7-8 days ago, what % came back at
  // least once a week after signing up? (We only store lastSeenAt, not a full
  // activity log, so "came back on exactly day 7" isn't knowable — this is the
  // closest honest approximation available from the current schema.)
  const cohortStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  const cohortEnd = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    totalUsers, premiumUsers, activeToday, totalModules, pendingSubs, revenueResult,
    inactiveCount, newUsersToday, d7Cohort,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { isPremium: true } }),
    db.user.count({ where: { lastSeenAt: { gte: today } } }),
    db.module.count({ where: { isPublished: true } }),
    db.subscription.count({ where: { status: 'pending' } }),
    db.subscription.findMany({
      where: { status: 'active', startedAt: { gte: monthStart } },
      select: { plan: true },
    }),
    db.user.count({ where: { lastSeenAt: { lt: fourteenDaysAgo } } }),
    db.user.count({ where: { createdAt: { gte: today } } }),
    db.user.findMany({
      where: { createdAt: { gte: cohortStart, lt: cohortEnd } },
      select: { createdAt: true, lastSeenAt: true },
    }),
  ])

  const PLAN_PRICES: Record<string, number> = { monthly: 15000, annual: 120000 }
  const revenueMtd = revenueResult.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] ?? 0), 0)

  const d7Retained = d7Cohort.filter(
    (u) => u.lastSeenAt.getTime() >= u.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).length
  const d7Retention = d7Cohort.length > 0 ? Number(((d7Retained / d7Cohort.length) * 100).toFixed(1)) : 0

  return c.json({
    data: {
      totalUsers,
      premiumUsers,
      activeToday,
      totalModules,
      pendingSubs,
      revenueMtd,
      inactiveUsers: inactiveCount,
      newUsersToday,
      d7Retention,
      conversionRate: totalUsers > 0 ? Number(((premiumUsers / totalUsers) * 100).toFixed(1)) : 0,
    },
  })
})

admin.get('/dashboard/recent-users', async (c) => {
  const users = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      phone: true,
      displayName: true,
      isPremium: true,
      createdAt: true,
      lastSeenAt: true,
    },
  })
  return c.json({ data: users })
})

// ── Users ─────────────────────────────────────────────────────────────────────

admin.get('/users', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const search = c.req.query('search') ?? ''
  const filter = c.req.query('filter') ?? 'all'
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const baseWhere = {
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  }

  const filterWhere =
    filter === 'premium' ? { isPremium: true } :
    filter === 'free' ? { isPremium: false } :
    filter === 'inactive' ? { lastSeenAt: { lt: fourteenDaysAgo } } :
    {}

  const where = { ...baseWhere, ...filterWhere }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      skip: (page - 1) * 20,
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        displayName: true,
        isPremium: true,
        language: true,
        level: true,
        createdAt: true,
        lastSeenAt: true,
      },
    }),
    db.user.count({ where }),
  ])

  return c.json({ data: { users, total, page, pageSize: 20 } })
})

admin.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = await db.user.findUnique({
    where: { id },
    include: {
      subscription: true,
      paperAccount: {
        include: {
          holdings: true,
          trades: { select: { id: true } },
        },
      },
      moduleProgress: { select: { status: true, quizScore: true } },
    },
  })
  if (!user) return c.json({ error: 'User not found' }, 404)

  const [totalModules, weekSnapshot] = await Promise.all([
    db.module.count({ where: { isPublished: true } }),
    db.leaderboardSnapshot.findUnique({
      where: { userId_weekStart: { userId: id, weekStart: getLeaderboardWeekStart() } },
      select: { rank: true },
    }),
  ])

  const modulesCompleted = user.moduleProgress.filter((p) => p.status === 'completed').length
  const scored = user.moduleProgress.filter((p) => p.quizScore != null)
  const avgQuizScore = scored.length > 0
    ? Math.round(scored.reduce((sum, p) => sum + (p.quizScore ?? 0), 0) / scored.length)
    : null

  let portfolioValue: string | null = null
  let portfolioGainPct: number | null = null
  if (user.paperAccount) {
    const symbols = [...new Set(user.paperAccount.holdings.map((h) => h.symbol))]
    const prices = symbols.length > 0
      ? await db.stockPrice.findMany({ where: { symbol: { in: symbols } }, select: { symbol: true, currentPrice: true } })
      : []
    const priceMap = new Map(prices.map((p) => [p.symbol, p.currentPrice]))
    const holdingsValue = user.paperAccount.holdings.reduce(
      (sum, h) => sum + BigInt(h.quantity) * (priceMap.get(h.symbol) ?? 0n),
      0n,
    )
    const totalValue = user.paperAccount.cashBalance + holdingsValue
    portfolioValue = totalValue.toString()
    portfolioGainPct = user.paperAccount.initialValue > 0n
      ? Number(((Number(totalValue - user.paperAccount.initialValue) / Number(user.paperAccount.initialValue)) * 100).toFixed(2))
      : 0
  }

  const { moduleProgress: _moduleProgress, ...userFields } = user

  return c.json({
    data: {
      ...userFields,
      stats: {
        modulesCompleted,
        totalModules,
        avgQuizScore,
        portfolioValue,
        portfolioGainPct,
        totalTrades: user.paperAccount?.trades.length ?? 0,
        rank: weekSnapshot?.rank ?? null,
      },
    },
  })
})

admin.post('/users/:id/reset-paper', async (c) => {
  const user = await db.user.findUnique({
    where: { id: c.req.param('id') },
    include: { paperAccount: true },
  })
  if (!user?.paperAccount) return c.json({ error: 'Paper account not found' }, 404)

  await db.$transaction([
    db.paperHolding.deleteMany({ where: { accountId: user.paperAccount.id } }),
    db.paperAccount.update({
      where: { id: user.paperAccount.id },
      data: { cashBalance: 5000000n, resetCount: { increment: 1 }, lastResetAt: new Date() },
    }),
  ])
  return c.json({ data: { success: true } })
})

admin.post('/users/:id/cancel-subscription', async (c) => {
  const sub = await db.subscription.findUnique({ where: { userId: c.req.param('id') } })
  if (!sub) return c.json({ error: 'Subscription not found' }, 404)

  await db.$transaction([
    db.subscription.update({
      where: { id: sub.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    }),
    db.user.update({ where: { id: c.req.param('id') }, data: { isPremium: false } }),
  ])
  return c.json({ data: { success: true } })
})

admin.post('/users/:id/push', zValidator('json', z.object({
  titleEn: z.string().min(1),
  titleAm: z.string().min(1),
  bodyEn: z.string().min(1),
  bodyAm: z.string().min(1),
  url: z.string().optional(),
})), async (c) => {
  const { titleEn, bodyEn, url } = c.req.valid('json')
  const subs = await db.pushSubscription.findMany({ where: { userId: c.req.param('id') } })

  await Promise.allSettled(
    subs.map((s) =>
      sendPushNotification(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        { title: titleEn, body: bodyEn, url },
      ),
    ),
  )
  return c.json({ data: { sent: subs.length } })
})

admin.get('/users/:id/export', async (c) => {
  const user = await db.user.findUnique({
    where: { id: c.req.param('id') },
    include: {
      subscription: true,
      paperAccount: { include: { trades: true, holdings: true } },
      moduleProgress: true,
      watchlistItems: true,
      priceAlerts: true,
    },
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
  type: z.enum(['video', 'article', 'interactive']),
  track: z.enum(['foundation', 'intermediate', 'advanced']),
  orderIndex: z.number().int().nonnegative(),
  isPremium: z.boolean().default(false),
  durationMin: z.number().int().positive().optional(),
  videoUrl: z.string().url().optional(),
  contentAm: z.string().optional(),
  contentEn: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
})

const quizQuestionSchema = z.object({
  questionAm: z.string().min(1),
  questionEn: z.string().min(1),
  optionsAm: z.array(z.string().min(1)).length(4),
  optionsEn: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanationAm: z.string().optional(),
  explanationEn: z.string().optional(),
  orderIndex: z.number().int().nonnegative(),
})

admin.get('/modules', async (c) => {
  const mods = await db.module.findMany({
    orderBy: [{ track: 'asc' }, { orderIndex: 'asc' }],
    include: {
      _count: { select: { quizQuestions: true } },
      quizQuestions: { orderBy: { orderIndex: 'asc' } },
    },
  })
  return c.json({ data: mods })
})

admin.get('/modules/:id', async (c) => {
  const mod = await db.module.findUnique({
    where: { id: c.req.param('id') },
    include: { quizQuestions: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!mod) return c.json({ error: 'Module not found' }, 404)
  return c.json({ data: mod })
})

admin.post('/modules', zValidator('json', moduleSchema.extend({
  questions: z.array(quizQuestionSchema).optional(),
})), async (c) => {
  const { questions, ...moduleData } = c.req.valid('json')
  const mod = await db.module.create({
    data: {
      ...moduleData,
      quizQuestions: questions?.length
        ? { create: questions }
        : undefined,
    },
    include: { quizQuestions: true },
  })
  return c.json({ data: mod }, 201)
})

admin.put('/modules/:id', zValidator('json', moduleSchema.partial().extend({
  questions: z.array(quizQuestionSchema.extend({ id: z.string().optional() })).optional(),
})), async (c) => {
  const { questions, ...moduleData } = c.req.valid('json')
  const id = c.req.param('id')

  const mod = await db.$transaction(async (tx) => {
    const updated = await tx.module.update({ where: { id }, data: moduleData })
    if (questions !== undefined) {
      await tx.quizQuestion.deleteMany({ where: { moduleId: id } })
      if (questions.length > 0) {
        await tx.quizQuestion.createMany({
          data: questions.map(({ id: _id, ...q }) => ({ ...q, moduleId: id })),
        })
      }
    }
    return updated
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

admin.put('/modules/:id/publish', async (c) => {
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

admin.put('/modules/:id/unpublish', async (c) => {
  const mod = await db.module.update({
    where: { id: c.req.param('id') },
    data: { isPublished: false },
  })
  return c.json({ data: mod })
})

// ── Prices ────────────────────────────────────────────────────────────────────

const priceRowSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
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

admin.put('/prices', zValidator('json', z.object({ prices: priceUpdateSchema })), async (c) => {
  const { prices } = c.req.valid('json')
  const tradingDate = new Date(prices[0].tradingDate)
  const results = await db.$transaction(prices.map((u) => buildPriceUpsert(u, tradingDate)))
  return c.json({ data: { updated: results.length } })
})

// The CSV is filled in by hand, so prices are entered as whole-ETB decimals
// (e.g. 850.00). Everywhere else in the system (including the price table's own
// bulk-update payload) prices travel as integer santims — convert once here, at
// the one point actual human-typed decimal input enters the system.
const etbToSantims = (n: number) => Math.round(n * 100)

// CSV upload: parse and return preview (does not save)
admin.post('/prices/csv', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const text = await file.text()
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return c.json({ error: 'CSV must have a header row and at least one data row' }, 400)

  const headers = lines[0].split(',').map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim())
    return headers.reduce<Record<string, string>>((obj, h, i) => ({ ...obj, [h]: vals[i] ?? '' }), {})
  })

  // The common case is updating an already-listed symbol, so nameEn/nameAm are
  // optional in the CSV — backfill them from the existing row when omitted.
  const symbols = [...new Set(rows.map((r) => (r.symbol ?? '').trim().toUpperCase()).filter(Boolean))]
  const existing = symbols.length > 0
    ? await db.stockPrice.findMany({ where: { symbol: { in: symbols } }, distinct: ['symbol'], select: { symbol: true, nameEn: true, nameAm: true, sector: true } })
    : []
  const existingBySymbol = new Map(existing.map((s) => [s.symbol, s]))

  const parsed = priceUpdateSchema.safeParse(
    rows.map((r) => {
      const openPriceEtb = r.open_price ?? r.openPrice
      const dayHighEtb = r.day_high ?? r.dayHigh
      const dayLowEtb = r.day_low ?? r.dayLow
      const known = existingBySymbol.get((r.symbol ?? '').trim().toUpperCase())
      return {
        ...r,
        nameEn: r.nameEn || r.name_en || known?.nameEn,
        nameAm: r.nameAm || r.name_am || known?.nameAm,
        sector: r.sector || known?.sector || undefined,
        currentPrice: etbToSantims(Number(r.current_price ?? r.currentPrice)),
        previousClose: etbToSantims(Number(r.previous_close ?? r.previousClose)),
        openPrice: openPriceEtb ? etbToSantims(Number(openPriceEtb)) : undefined,
        dayHigh: dayHighEtb ? etbToSantims(Number(dayHighEtb)) : undefined,
        dayLow: dayLowEtb ? etbToSantims(Number(dayLowEtb)) : undefined,
        volume: r.volume ? Number(r.volume) : undefined,
        tradingDate: r.trading_date ?? r.tradingDate ?? new Date().toISOString().slice(0, 10),
      }
    }),
  )
  if (!parsed.success) return c.json({ error: 'Invalid CSV data — for a new symbol, include name_en and name_am columns', details: parsed.error.flatten() }, 400)

  return c.json({ data: { preview: parsed.data } })
})

// CSV confirm: actually save the previewed data
admin.post('/prices/csv/confirm', zValidator('json', z.object({ prices: priceUpdateSchema })), async (c) => {
  const { prices } = c.req.valid('json')
  const tradingDate = new Date(prices[0].tradingDate)
  const results = await db.$transaction(prices.map((u) => buildPriceUpsert(u, tradingDate)))
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
  const sub = await db.subscription.findUniqueOrThrow({
    where: { id: c.req.param('id') },
    include: { user: true },
  })
  const monthsToAdd = sub.plan === 'annual' ? 12 : 1
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + monthsToAdd)

  await db.$transaction([
    db.subscription.update({
      where: { id: sub.id },
      data: { status: 'active', currentPeriodEnd: periodEnd },
    }),
    db.user.update({ where: { id: sub.userId }, data: { isPremium: true } }),
  ])

  sendAdminNotification(
    'Subscription confirmed',
    `<strong>${sub.user.displayName ?? sub.user.phone}</strong> subscription confirmed.<br>Plan: ${sub.plan} · Expires: ${periodEnd.toDateString()}`,
  ).catch(() => {})

  return c.json({ data: { success: true } })
})

// Accept both POST and PUT from admin client
admin.put('/subscriptions/:id/confirm', async (c) => {
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: c.req.param('id') } })
  const monthsToAdd = sub.plan === 'annual' ? 12 : 1
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + monthsToAdd)

  await db.$transaction([
    db.subscription.update({
      where: { id: sub.id },
      data: { status: 'active', currentPeriodEnd: periodEnd },
    }),
    db.user.update({ where: { id: sub.userId }, data: { isPremium: true } }),
  ])
  return c.json({ data: { success: true } })
})

admin.post('/subscriptions/:id/reject', async (c) => {
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: c.req.param('id') } })
  await db.subscription.update({ where: { id: sub.id }, data: { status: 'rejected' } })
  return c.json({ data: { success: true } })
})

admin.put('/subscriptions/:id/reject', async (c) => {
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: c.req.param('id') } })
  await db.subscription.update({ where: { id: sub.id }, data: { status: 'rejected' } })
  return c.json({ data: { success: true } })
})

// ── Push notifications ────────────────────────────────────────────────────────

const broadcastSchema = z.object({
  titleEn: z.string().min(1),
  titleAm: z.string().min(1),
  bodyEn: z.string().min(1),
  bodyAm: z.string().min(1),
  url: z.string().optional(),
  segment: z.enum(['all', 'premium', 'free', 'inactive']).default('all'),
})

admin.post('/push/broadcast', zValidator('json', broadcastSchema), async (c) => {
  const { titleEn, bodyEn, url, segment } = c.req.valid('json')
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const userFilter =
    segment === 'premium' ? { isPremium: true } :
    segment === 'free' ? { isPremium: false } :
    segment === 'inactive' ? { lastSeenAt: { lt: sevenDaysAgo } } :
    undefined

  const subs = await db.pushSubscription.findMany({
    where: userFilter ? { user: userFilter } : undefined,
  })

  let sent = 0
  let failed = 0

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { title: titleEn, body: bodyEn, url },
        )
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

// ── File uploads ──────────────────────────────────────────────────────────────

// ImageKit auth params for client-side direct upload
admin.get('/upload/auth', (c) => {
  try {
    const params = getImageKitAuthParams()
    return c.json({ data: { ...params, publicKey: process.env.IMAGEKIT_PUBLIC_KEY } })
  } catch {
    return c.json({ error: 'ImageKit not configured' }, 503)
  }
})

// Upload image to ImageKit
admin.post('/upload/image', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await uploadToImageKit(buffer, file.name, 'images')
  return c.json({ data: result })
})

// Upload thumbnail to ImageKit
admin.post('/upload/thumbnail', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await uploadToImageKit(buffer, file.name, 'thumbnails')
  return c.json({ data: result })
})

// Upload document to ImageKit
admin.post('/upload/document', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await uploadToImageKit(buffer, file.name, 'documents')
  return c.json({ data: result })
})

// Upload video to ImageKit
admin.post('/upload/video/imagekit', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await uploadToImageKit(buffer, file.name, 'videos')
  return c.json({ data: { url: result.url, fileId: result.fileId, embedUrl: result.url } })
})

// Upload video to YouTube
admin.post('/upload/video/youtube', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const title = form.get('title') as string | null
  const description = (form.get('description') as string | null) ?? ''
  const visibility = (form.get('visibility') as YouTubeVisibility | null) ?? 'unlisted'

  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)
  if (!title) return c.json({ error: 'title is required' }, 400)

  const validVisibilities: YouTubeVisibility[] = ['public', 'unlisted', 'private']
  if (!validVisibilities.includes(visibility)) {
    return c.json({ error: 'visibility must be public, unlisted, or private' }, 400)
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadToYouTube(buffer, {
      title,
      description,
      visibility,
      mimeType: file.type || 'video/*',
    })
    return c.json({ data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'YouTube upload failed'
    return c.json({ error: msg }, 503)
  }
})

// Delete file from ImageKit
admin.delete('/upload/file', zValidator('json', z.object({ fileId: z.string().min(1) })), async (c) => {
  const { fileId } = c.req.valid('json')
  await deleteFromImageKit(fileId)
  return c.json({ data: { success: true } })
})

// ── Auth settings ─────────────────────────────────────────────────────────────
// Toggling a method off only blocks *new* logins through it — existing JWTs are
// stateless and stay valid until they naturally expire.

admin.get('/auth-settings', async (c) => {
  const settings = await getAuthSettings()
  return c.json({ data: settings })
})

admin.put('/auth-settings', zValidator('json', UpdateAuthSettingsSchema), async (c) => {
  try {
    const settings = await updateAuthSettings(c.req.valid('json'))
    return c.json({ data: settings })
  } catch (e) {
    if (e instanceof AuthSettingsError) return c.json({ error: e.message, code: 'VALIDATION_ERROR' }, 400)
    throw e
  }
})

export default admin
