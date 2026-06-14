import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const modules = new Hono<{ Variables: AuthVariables }>()

modules.use('*', authMiddleware)

const progressSchema = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed']).optional(),
  videoPosition: z.number().int().nonnegative().optional(),
})

const quizSchema = z.object({
  answers: z.array(z.number().int().nonnegative()),
})

modules.get('/', async (c) => {
  const track = c.req.query('track')
  const mods = await db.module.findMany({
    where: { isPublished: true, ...(track ? { track } : {}) },
    orderBy: [{ track: 'asc' }, { orderIndex: 'asc' }],
    select: {
      id: true,
      slug: true,
      titleAm: true,
      titleEn: true,
      descriptionAm: true,
      descriptionEn: true,
      type: true,
      track: true,
      orderIndex: true,
      isPremium: true,
      durationMin: true,
      thumbnailUrl: true,
    },
  })
  return c.json({ data: mods })
})

modules.get('/:slug', async (c) => {
  const userId = c.get('userId')
  const isPremium = c.get('isPremium')
  const slug = c.req.param('slug')

  const mod = await db.module.findUnique({
    where: { slug, isPublished: true },
    include: { quizQuestions: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!mod) return c.json({ error: 'Module not found' }, 404)
  if (mod.isPremium && !isPremium) {
    return c.json({ error: 'Premium required', code: 'MODULE_LOCKED' }, 403)
  }

  const progress = await db.userModuleProgress.findUnique({
    where: { userId_moduleId: { userId, moduleId: mod.id } },
  })

  await db.userModuleProgress.upsert({
    where: { userId_moduleId: { userId, moduleId: mod.id } },
    create: { userId, moduleId: mod.id },
    update: { lastAccessed: new Date() },
  })

  return c.json({ data: { ...mod, progress } })
})

modules.post('/:slug/progress', zValidator('json', progressSchema), async (c) => {
  const userId = c.get('userId')
  const slug = c.req.param('slug')
  const body = c.req.valid('json')

  const mod = await db.module.findUnique({ where: { slug } })
  if (!mod) return c.json({ error: 'Module not found' }, 404)

  const progress = await db.userModuleProgress.upsert({
    where: { userId_moduleId: { userId, moduleId: mod.id } },
    create: {
      userId,
      moduleId: mod.id,
      ...body,
      ...(body.status === 'completed' ? { completedAt: new Date() } : {}),
    },
    update: {
      ...body,
      lastAccessed: new Date(),
      ...(body.status === 'completed' ? { completedAt: new Date() } : {}),
    },
  })

  return c.json({ data: progress })
})

modules.post('/:slug/quiz', zValidator('json', quizSchema), async (c) => {
  const userId = c.get('userId')
  const slug = c.req.param('slug')
  const { answers } = c.req.valid('json')

  const mod = await db.module.findUnique({
    where: { slug },
    include: { quizQuestions: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!mod) return c.json({ error: 'Module not found' }, 404)

  const questions = mod.quizQuestions
  let correct = 0
  const results = questions.map((q, i) => {
    const isCorrect = answers[i] === q.correctIndex
    if (isCorrect) correct++
    return { questionId: q.id, isCorrect, correctIndex: q.correctIndex }
  })

  const score = Math.round((correct / questions.length) * 100)
  const passed = score >= 60

  await db.userModuleProgress.upsert({
    where: { userId_moduleId: { userId, moduleId: mod.id } },
    create: {
      userId,
      moduleId: mod.id,
      quizScore: score,
      quizAttempts: 1,
      ...(passed ? { status: 'completed', completedAt: new Date() } : {}),
    },
    update: {
      quizScore: score,
      quizAttempts: { increment: 1 },
      lastAccessed: new Date(),
      ...(passed ? { status: 'completed', completedAt: new Date() } : {}),
    },
  })

  return c.json({ data: { score, passed, results } })
})

export default modules
