import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const leaderboard = new Hono<{ Variables: AuthVariables }>()

leaderboard.use('*', authMiddleware)

leaderboard.get('/', async (c) => {
  const userId = c.get('userId')

  const latestSnap = await db.leaderboardSnapshot.findFirst({
    orderBy: { weekStart: 'desc' },
  })
  if (!latestSnap) return c.json({ data: { top10: [], weekStart: null, userRank: null } })

  const weekStart = latestSnap.weekStart

  const [top10, userSnap] = await Promise.all([
    db.leaderboardSnapshot.findMany({
      where: { weekStart },
      orderBy: { returnPct: 'desc' },
      take: 10,
      include: { user: { select: { displayName: true, avatarUrl: true } } },
    }),
    db.leaderboardSnapshot.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    }),
  ])

  return c.json({ data: { top10, weekStart, userRank: userSnap?.rank ?? null } })
})

leaderboard.get('/history', async (c) => {
  const userId = c.get('userId')
  const history = await db.leaderboardSnapshot.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    take: 12,
  })
  return c.json({ data: history })
})

export default leaderboard
