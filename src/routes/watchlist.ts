import { Hono } from 'hono'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const watchlist = new Hono<{ Variables: AuthVariables }>()

watchlist.use('*', authMiddleware)

async function withPrices(items: { id: string; userId: string; symbol: string; addedAt: Date }[]) {
  const symbols = [...new Set(items.map((i) => i.symbol))]
  const stocks = symbols.length > 0
    ? await db.stockPrice.findMany({ where: { symbol: { in: symbols } }, orderBy: { tradingDate: 'desc' }, distinct: ['symbol'] })
    : []
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]))

  return items.map((item) => {
    const stock = bySymbol.get(item.symbol)
    const currentPrice = stock ? Number(stock.currentPrice) : null
    const changePct = stock && stock.previousClose > 0n
      ? Number((((stock.currentPrice - stock.previousClose) * 10000n) / stock.previousClose)) / 100
      : null
    return {
      ...item,
      nameEn: stock?.nameEn ?? item.symbol,
      nameAm: stock?.nameAm ?? item.symbol,
      currentPrice,
      changePct,
    }
  })
}

watchlist.get('/', async (c) => {
  const items = await db.watchlistItem.findMany({
    where: { userId: c.get('userId') },
    orderBy: { addedAt: 'desc' },
  })
  return c.json({ data: await withPrices(items) })
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

  const [enriched] = await withPrices([item])
  return c.json({ data: enriched }, 201)
})

watchlist.delete('/:symbol', async (c) => {
  const userId = c.get('userId')
  const symbol = c.req.param('symbol').toUpperCase()
  await db.watchlistItem.deleteMany({ where: { userId, symbol } })
  return c.json({ data: { success: true } })
})

export default watchlist
