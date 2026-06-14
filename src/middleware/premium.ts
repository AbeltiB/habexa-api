import { createMiddleware } from 'hono/factory'
import type { AuthVariables } from './auth.js'

export const premiumMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (!c.get('isPremium')) {
    return c.json({ error: 'Premium required', code: 'MODULE_LOCKED' }, 403)
  }
  await next()
})
