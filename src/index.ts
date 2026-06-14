import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'

import auth from './routes/auth.js'
import user from './routes/user.js'
import modules from './routes/modules.js'
import paper from './routes/paper.js'
import market from './routes/market.js'
import leaderboard from './routes/leaderboard.js'
import watchlist from './routes/watchlist.js'
import alerts from './routes/alerts.js'
import subscription from './routes/subscription.js'
import push from './routes/push.js'
import admin from './routes/admin.js'

// Allow BigInt values to be serialised as strings in JSON responses
;(BigInt.prototype as unknown as Record<string, unknown>).toJSON = function () {
  return this.toString()
}

const app = new Hono()

app.use('*', logger())
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: [
      process.env.WEB_URL ?? 'https://habexa.com',
      'https://admin.habexa.com',
    ],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  }),
)

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

app.route('/auth', auth)
app.route('/api/user', user)
app.route('/api/modules', modules)
app.route('/api/paper', paper)
app.route('/api/market', market)
app.route('/api/leaderboard', leaderboard)
app.route('/api/watchlist', watchlist)
app.route('/api/alerts', alerts)
app.route('/api/subscription', subscription)
app.route('/api/push', push)
app.route('/admin', admin)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

const port = Number(process.env.PORT ?? 8080)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Habexa API running on http://localhost:${info.port}`)
})

export default app
