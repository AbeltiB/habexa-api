import { createMiddleware } from 'hono/factory'
import { redis } from '../lib/redis.js'
import type { AuthVariables } from './auth.js'

interface RateLimitConfig {
  max: number
  windowSecs: number
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  'POST:/auth/request-otp': { max: 3, windowSecs: 600 },
  'POST:/auth/verify-otp': { max: 10, windowSecs: 300 },
}

const DEFAULT_LIMIT: RateLimitConfig = { max: 60, windowSecs: 60 }

export const rateLimitMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const userId = c.get('userId')
  const routeKey = `${c.req.method}:${c.req.path}`
  const config = ROUTE_LIMITS[routeKey] ?? DEFAULT_LIMIT
  const key = `ratelimit:${userId}:${routeKey}`

  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, config.windowSecs)
  }

  if (count > config.max) {
    return c.json({ error: 'Too many requests' }, 429, {
      'Retry-After': String(config.windowSecs),
    })
  }

  await next()
})
