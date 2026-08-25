import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'
import type { StockPrice as PrismaStockPrice } from '@prisma/client'

const market = new Hono<{ Variables: AuthVariables }>()

market.use('*', authMiddleware)

function toSummary(s: PrismaStockPrice) {
  const changeAmount = s.currentPrice - s.previousClose
  const changePct = s.previousClose > 0n
    ? Number((changeAmount * 10000n) / s.previousClose) / 100
    : 0
  return {
    symbol: s.symbol,
    nameEn: s.nameEn,
    nameAm: s.nameAm,
    currentPrice: s.currentPrice,
    previousClose: s.previousClose,
    changeAmount,
    changePct,
    isGainer: changePct > 0,
    isLoser: changePct < 0,
    tradingDate: s.tradingDate,
  }
}

market.get('/stocks', async (c) => {
  const stocks = await db.stockPrice.findMany({
    orderBy: { updatedAt: 'desc' },
    distinct: ['symbol'],
  })
  return c.json({ data: stocks.map(toSummary) })
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

  const summaries = stocks.map(toSummary)
  const sorted = [...summaries].sort((a, b) => b.changePct - a.changePct)
  const gainers = sorted.slice(0, 3)
  const losers = [...summaries].sort((a, b) => a.changePct - b.changePct).slice(0, 3)

  return c.json({ data: { gainers, losers, lastUpdated: new Date().toISOString() } })
})

export default market
