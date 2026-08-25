import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'
import { PAPER_ACCOUNT_INITIAL_VALUE } from '@habexa/sdk'

const leaderboard = new Hono<{ Variables: AuthVariables }>()

leaderboard.use('*', authMiddleware)

function toEntry(snap: {
  userId: string
  weekStart: Date
  rank: number | null
  portfolioValue: bigint
  returnPct: unknown
  user?: { displayName: string | null; avatarUrl: string | null }
}) {
  return {
    userId: snap.userId,
    displayName: snap.user?.displayName ?? null,
    avatarUrl: snap.user?.avatarUrl ?? null,
    rank: snap.rank,
    portfolioValue: snap.portfolioValue,
    returnPct: Number(snap.returnPct),
    returnAmount: snap.portfolioValue - BigInt(PAPER_ACCOUNT_INITIAL_VALUE),
    weekStart: snap.weekStart,
  }
}

leaderboard.get('/', async (c) => {
  const userId = c.get('userId')

  const latestSnap = await db.leaderboardSnapshot.findFirst({
    orderBy: { weekStart: 'desc' },
  })
  if (!latestSnap) {
    return c.json({ data: { entries: [], weekStart: null, myRank: null, myEntry: null, userPercentile: null, totalRanked: 0 } })
  }

  const weekStart = latestSnap.weekStart

  const [top10, userSnap, totalRanked] = await Promise.all([
    db.leaderboardSnapshot.findMany({
      where: { weekStart },
      orderBy: { returnPct: 'desc' },
      take: 10,
      include: { user: { select: { displayName: true, avatarUrl: true } } },
    }),
    db.leaderboardSnapshot.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
      include: { user: { select: { displayName: true, avatarUrl: true } } },
    }),
    db.leaderboardSnapshot.count({ where: { weekStart } }),
  ])

  // percentile = % of ranked users this user beat, 100 = top of the board
  const userPercentile =
    userSnap?.rank && totalRanked > 0
      ? Number((((totalRanked - userSnap.rank) / totalRanked) * 100).toFixed(1))
      : null

  return c.json({
    data: {
      entries: top10.map(toEntry),
      weekStart,
      myRank: userSnap?.rank ?? null,
      myEntry: userSnap ? toEntry(userSnap) : null,
      userPercentile,
      totalRanked,
    },
  })
})

leaderboard.get('/history', async (c) => {
  const userId = c.get('userId')
  const history = await db.leaderboardSnapshot.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    take: 12,
  })
  return c.json({ data: history.map(toEntry) })
})

export default leaderboard
