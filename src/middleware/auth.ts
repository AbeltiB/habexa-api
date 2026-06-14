import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'

export type AuthVariables = {
  userId: string
  isPremium: boolean
}

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)
  try {
    const payload = await verify(token, process.env.JWT_SECRET!)
    c.set('userId', payload.sub as string)
    c.set('isPremium', Boolean(payload.isPremium))
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})
