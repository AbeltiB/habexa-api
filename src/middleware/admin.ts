import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'crypto'

export const adminMiddleware = createMiddleware(async (c, next) => {
  const cookieHeader = c.req.header('cookie') ?? ''
  const adminCookie = cookieHeader
    .split(';')
    .find(s => s.trim().startsWith('habexa_admin='))
    ?.split('=')[1]
    ?.trim()

  const expected = process.env.ADMIN_SECRET
  if (!adminCookie || !expected) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const a = Buffer.from(adminCookie)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await next()
})
