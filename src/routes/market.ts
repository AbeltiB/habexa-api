import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const market = new Hono<{ Variables: AuthVariables }>()

market.use('*', authMiddleware)

market.get('/stocks', async (c) => {
  const stocks = await db.stockPrice.findMany({
    orderBy: { updatedAt: 'desc' },
    distinct: ['symbol'],
  })
  return c.json({ data: stocks })
})

market.get('/stocks/:symbol', async (c) => {
  const symbol = c.req.param('symbol').toUpperCase()
  const stock = await db.stockPrice.findFirst({
    where: { symbol },
    orderBy: { tradingDate: 'desc' },
  })
  if (!stock) return c.json({ error: 'Stock not found' }, 404)
  return c.json({ data: stock })
})

market.get('/movers', async (c) => {
  const stocks = await db.stockPrice.findMany({
    orderBy: { updatedAt: 'desc' },
    distinct: ['symbol'],
  })

  const withChange = stocks.map(s => ({
    ...s,
    changePercent:
      s.previousClose > 0n
        ? Number((s.currentPrice - s.previousClose) * 10000n / s.previousClose) / 100
        : 0,
  }))

  const sorted = [...withChange].sort((a, b) => b.changePercent - a.changePercent)
  const gainers = sorted.slice(0, 3)
  const losers = [...withChange].sort((a, b) => a.changePercent - b.changePercent).slice(0, 3)

  return c.json({ data: { gainers, losers } })
})

export default market
