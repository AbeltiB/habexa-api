import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sign } from 'hono/jwt'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { sendOTP } from '../lib/afrosms.js'
import { hashCode, verifyCode } from '../lib/crypto.js'

const auth = new Hono()

const requestOtpSchema = z.object({
  phone: z.string().regex(/^\+251[0-9]{9}$/, 'Invalid Ethiopian phone number (+251XXXXXXXXX)'),
})

const verifyOtpSchema = z.object({
  phone: z.string(),
  code: z.string().length(6),
})

auth.post('/request-otp', zValidator('json', requestOtpSchema), async (c) => {
  const { phone } = c.req.valid('json')

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
  const recentCount = await db.otpSession.count({
    where: { phone, createdAt: { gte: tenMinutesAgo } },
  })
  if (recentCount >= 3) {
    return c.json({ error: 'Too many OTP requests. Try again in 10 minutes.' }, 429)
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const hashedCode = await hashCode(code)
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

  await db.otpSession.create({ data: { phone, code: hashedCode, expiresAt } })
  await sendOTP(phone, code)

  return c.json({ data: { success: true, expiresIn: 300 } })
})

auth.post('/verify-otp', zValidator('json', verifyOtpSchema), async (c) => {
  const { phone, code } = c.req.valid('json')

  const session = await db.otpSession.findFirst({
    where: {
      phone,
      verified: false,
      expiresAt: { gt: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!session) {
    return c.json({ error: 'OTP expired or invalid' }, 400)
  }

  const valid = await verifyCode(code, session.code)
  if (!valid) {
    await db.otpSession.update({
      where: { id: session.id },
      data: { attempts: { increment: 1 } },
    })
    return c.json({ error: 'Invalid OTP code' }, 400)
  }

  await db.otpSession.update({ where: { id: session.id }, data: { verified: true } })

  let user = await db.user.findUnique({ where: { phone } })
  let isNewUser = false

  if (!user) {
    isNewUser = true
    user = await db.user.create({
      data: {
        phone,
        referralCode: generateReferralCode(),
        paperAccount: { create: {} },
      },
    })
  } else {
    await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
  }

  const token = await sign(
    {
      sub: user.id,
      isPremium: user.isPremium,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    },
    process.env.JWT_SECRET!,
  )

  return c.json({ data: { token, user, isNewUser } })
})

auth.delete('/session', async (c) => {
  return c.json({ data: { success: true } })
})

function generateReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default auth
