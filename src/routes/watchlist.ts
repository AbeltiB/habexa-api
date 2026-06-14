import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const watchlist = new Hono<{ Variables: AuthVariables }>()

watchlist.use('*', authMiddleware)

watchlist.get('/', async (c) => {
  const items = await db.watchlistItem.findMany({
    where: { userId: c.get('userId') },
    orderBy: { addedAt: 'desc' },
  })
  return c.json({ data: items })
})

watchlist.post('/:symbol', async (c) => {
  const userId = c.get('userId')
  const symbol = c.req.param('symbol').toUpperCase()

  const stock = await db.stockPrice.findFirst({ where: { symbol } })
  if (!stock) return c.json({ error: 'Stock not found' }, 404)

  const item = await db.watchlistItem.upsert({
    where: { userId_symbol: { userId, symbol } },
    create: { userId, symbol },
    update: {},
  })

  return c.json({ data: item }, 201)
})

watchlist.delete('/:symbol', async (c) => {
  const userId = c.get('userId')
  const symbol = c.req.param('symbol').toUpperCase()
  await db.watchlistItem.deleteMany({ where: { userId, symbol } })
  return c.json({ data: { success: true } })
})

export default watchlist
