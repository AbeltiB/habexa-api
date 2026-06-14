import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { db } from '../lib/db.js'

const paper = new Hono<{ Variables: AuthVariables }>()

paper.use('*', authMiddleware)

const tradeSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().int().positive(),
})

paper.get('/account', async (c) => {
  const userId = c.get('userId')

  const account = await db.paperAccount.findUniqueOrThrow({
    where: { userId },
    include: { holdings: true },
  })

  const symbols = account.holdings.map(h => h.symbol)
  const prices = symbols.length > 0
    ? await db.stockPrice.findMany({
        where: { symbol: { in: symbols } },
        orderBy: { tradingDate: 'desc' },
        distinct: ['symbol'],
      })
    : []

  const priceMap = new Map(prices.map(p => [p.symbol, p.currentPrice]))
  const holdingsValue = account.holdings.reduce((sum, h) => {
    const price = priceMap.get(h.symbol) ?? h.avgCostBasis
    return sum + price * BigInt(h.quantity)
  }, 0n)

  const totalValue = account.cashBalance + holdingsValue
  const returnPct =
    account.initialValue > 0n
      ? (Number(totalValue - account.initialValue) / Number(account.initialValue)) * 100
      : 0

  return c.json({
    data: {
      ...account,
      holdingsValue,
      totalValue,
      returnPct,
      holdings: account.holdings.map(h => ({
        ...h,
        currentPrice: priceMap.get(h.symbol) ?? null,
      })),
    },
  })
})

paper.get('/trades', async (c) => {
  const userId = c.get('userId')
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)))

  const account = await db.paperAccount.findUniqueOrThrow({ where: { userId } })
  const [trades, total] = await Promise.all([
    db.paperTrade.findMany({
      where: { accountId: account.id },
      orderBy: { executedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.paperTrade.count({ where: { accountId: account.id } }),
  ])

  return c.json({ data: { trades, total, page, pageSize } })
})

paper.post('/trade', zValidator('json', tradeSchema), async (c) => {
  const userId = c.get('userId')
  const { symbol, side, quantity } = c.req.valid('json')

  const stockPrice = await db.stockPrice.findFirst({
    where: { symbol },
    orderBy: { tradingDate: 'desc' },
  })
  if (!stockPrice) return c.json({ error: 'Stock not found' }, 404)

  const price = stockPrice.currentPrice
  const totalValue = price * BigInt(quantity)

  try {
    const trade = await db.$transaction(async (tx) => {
      const account = await tx.paperAccount.findUniqueOrThrow({ where: { userId } })

      if (side === 'BUY') {
        if (account.cashBalance < totalValue) {
          throw new Error('INSUFFICIENT_FUNDS')
        }

        await tx.paperAccount.update({
          where: { id: account.id },
          data: { cashBalance: { decrement: totalValue } },
        })

        const holding = await tx.paperHolding.findUnique({
          where: { accountId_symbol: { accountId: account.id, symbol } },
        })

        if (holding) {
          const newQty = holding.quantity + quantity
          const newAvg =
            (holding.avgCostBasis * BigInt(holding.quantity) + price * BigInt(quantity)) /
            BigInt(newQty)
          await tx.paperHolding.update({
            where: { accountId_symbol: { accountId: account.id, symbol } },
            data: { quantity: newQty, avgCostBasis: newAvg },
          })
        } else {
          await tx.paperHolding.create({
            data: { accountId: account.id, symbol, quantity, avgCostBasis: price },
          })
        }
      } else {
        const holding = await tx.paperHolding.findUnique({
          where: { accountId_symbol: { accountId: account.id, symbol } },
        })
        if (!holding || holding.quantity < quantity) {
          throw new Error('INSUFFICIENT_SHARES')
        }

        await tx.paperAccount.update({
          where: { id: account.id },
          data: { cashBalance: { increment: totalValue } },
        })

        if (holding.quantity === quantity) {
          await tx.paperHolding.delete({
            where: { accountId_symbol: { accountId: account.id, symbol } },
          })
        } else {
          await tx.paperHolding.update({
            where: { accountId_symbol: { accountId: account.id, symbol } },
            data: { quantity: { decrement: quantity } },
          })
        }
      }

      return tx.paperTrade.create({
        data: { accountId: account.id, symbol, side, quantity, priceAtExec: price, totalValue },
      })
    })

    return c.json({ data: trade }, 201)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'INSUFFICIENT_FUNDS') return c.json({ error: 'Insufficient funds' }, 400)
    if (msg === 'INSUFFICIENT_SHARES') return c.json({ error: 'Insufficient shares' }, 400)
    throw err
  }
})

paper.post('/reset', async (c) => {
  const userId = c.get('userId')
  const account = await db.paperAccount.findUniqueOrThrow({ where: { userId } })

  if (account.lastResetAt) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    if (account.lastResetAt > thirtyDaysAgo) {
      return c.json({ error: 'Reset only allowed once every 30 days' }, 400)
    }
  }

  await db.$transaction(async (tx) => {
    await tx.paperHolding.deleteMany({ where: { accountId: account.id } })
    await tx.paperAccount.update({
      where: { id: account.id },
      data: { cashBalance: 5_000_000n, resetCount: { increment: 1 }, lastResetAt: new Date() },
    })
  })

  return c.json({ data: { success: true } })
})

export default paper
