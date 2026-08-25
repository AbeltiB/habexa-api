import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sign } from 'hono/jwt'
import { z } from 'zod'
import {
  RequestOTPSchema,
  VerifyOTPSchema,
  TelegramAuthSchema,
  GoogleAuthSchema,
  RequestEmailOTPSchema,
  VerifyEmailOTPSchema,
  type ProfileCompletionState,
} from '@habexa/sdk'
import { db } from '../lib/db.js'
import { sendOTP } from '../lib/afrosms.js'
import { sendOTPEmail } from '../lib/email.js'
import { requestOtp, verifyOtp, verifyOtpForUser, OtpRateLimitError } from '../lib/otp.js'
import { verifyTelegramAuth } from '../lib/telegram.js'
import { verifyGoogleCredential } from '../lib/google.js'
import { getAuthSettings } from '../lib/auth-settings.js'
import { authMiddleware } from '../middleware/auth.js'
import type { User } from '@prisma/client'

const auth = new Hono()

function generateReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

async function signUserToken(user: User): Promise<string> {
  return sign(
    {
      sub: user.id,
      isPremium: user.isPremium,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    },
    process.env.JWT_SECRET!,
  )
}

function profileCompletion(user: User): ProfileCompletionState {
  return {
    needsDisplayName: !user.displayName,
    needsPhone: !user.phone,
    needsEmailVerification: Boolean(user.email) && !user.emailVerified,
  }
}

// ─── Auth method availability (drives which buttons the web login screen shows) ─

auth.get('/methods', async (c) => {
  const settings = await getAuthSettings()
  return c.json({
    data: {
      phoneAuthEnabled: settings.phoneAuthEnabled,
      googleAuthEnabled: settings.googleAuthEnabled,
      telegramAuthEnabled: settings.telegramAuthEnabled,
    },
  })
})

// ─── Phone + OTP (default, existing) ───────────────────────────────────────────

auth.post('/request-otp', zValidator('json', RequestOTPSchema), async (c) => {
  const { phone } = c.req.valid('json')

  const settings = await getAuthSettings()
  if (!settings.phoneAuthEnabled) {
    return c.json({ error: 'Phone sign-in is currently disabled', code: 'AUTH_METHOD_DISABLED' }, 403)
  }

  try {
    const code = await requestOtp('phone', phone)
    await sendOTP(phone, code)
    return c.json({ data: { success: true, expiresIn: 300 } })
  } catch (e) {
    if (e instanceof OtpRateLimitError) return c.json({ error: e.message, code: 'AUTH_RATE_LIMITED' }, 429)
    throw e
  }
})

auth.post('/verify-otp', zValidator('json', VerifyOTPSchema), async (c) => {
  const { phone, code } = c.req.valid('json')

  const valid = await verifyOtp('phone', phone, code)
  if (!valid) {
    return c.json({ error: 'OTP expired or invalid', code: 'AUTH_OTP_INVALID' }, 400)
  }

  let user = await db.user.findUnique({ where: { phone } })
  let isNewUser = false

  if (!user) {
    isNewUser = true
    user = await db.user.create({
      data: {
        phone,
        phoneVerified: true,
        referralCode: generateReferralCode(),
        paperAccount: { create: {} },
      },
    })
  } else {
    user = await db.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date(), phoneVerified: true },
    })
  }

  const token = await signUserToken(user)
  return c.json({ data: { token, user, isNewUser, profileCompletion: profileCompletion(user) } })
})

// ─── Telegram Login Widget ──────────────────────────────────────────────────────

auth.post('/telegram/callback', zValidator('json', TelegramAuthSchema), async (c) => {
  const payload = c.req.valid('json')

  const settings = await getAuthSettings()
  if (!settings.telegramAuthEnabled) {
    return c.json({ error: 'Telegram sign-in is currently disabled', code: 'AUTH_METHOD_DISABLED' }, 403)
  }

  try {
    verifyTelegramAuth(payload)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Invalid Telegram login', code: 'AUTH_OTP_INVALID' }, 400)
  }

  const telegramId = String(payload.id)
  let user = await db.user.findUnique({ where: { telegramId } })
  let isNewUser = false

  if (!user) {
    isNewUser = true
    const displayName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null
    user = await db.user.create({
      data: {
        telegramId,
        telegramUsername: payload.username ?? null,
        displayName,
        avatarUrl: payload.photo_url ?? null,
        referralCode: generateReferralCode(),
        paperAccount: { create: {} },
      },
    })
  } else {
    user = await db.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date(), telegramUsername: payload.username ?? user.telegramUsername },
    })
  }

  const token = await signUserToken(user)
  return c.json({ data: { token, user, isNewUser, profileCompletion: profileCompletion(user) } })
})

// ─── Google Sign-In ──────────────────────────────────────────────────────────────

auth.post('/google/callback', zValidator('json', GoogleAuthSchema), async (c) => {
  const { credential } = c.req.valid('json')

  const settings = await getAuthSettings()
  if (!settings.googleAuthEnabled) {
    return c.json({ error: 'Google sign-in is currently disabled', code: 'AUTH_METHOD_DISABLED' }, 403)
  }

  let google
  try {
    google = await verifyGoogleCredential(credential)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Invalid Google credential', code: 'AUTH_OTP_INVALID' }, 400)
  }

  let user = await db.user.findUnique({ where: { googleId: google.googleId } })
  let isNewUser = false

  if (!user) {
    // Link to an existing account with the same email (e.g. added via phone flow) instead of duplicating.
    const existingByEmail = await db.user.findUnique({ where: { email: google.email } })
    if (existingByEmail) {
      user = await db.user.update({
        where: { id: existingByEmail.id },
        data: { googleId: google.googleId, lastSeenAt: new Date() },
      })
    } else {
      isNewUser = true
      user = await db.user.create({
        data: {
          googleId: google.googleId,
          email: google.email,
          emailVerified: false, // re-verified via our own OTP below, even though Google already vouches for it
          displayName: google.displayName,
          avatarUrl: google.avatarUrl,
          referralCode: generateReferralCode(),
          paperAccount: { create: {} },
        },
      })
    }
  } else {
    user = await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
  }

  // Fire off the confirmatory email OTP in the background; login is not blocked on it.
  if (!user.emailVerified && user.email) {
    requestOtp('email', user.email, user.id)
      .then((code) => sendOTPEmail(user!.email!, code, user!.language as 'am' | 'en'))
      .catch(() => {})
  }

  const token = await signUserToken(user)
  return c.json({ data: { token, user, isNewUser, profileCompletion: profileCompletion(user) } })
})

// ─── Link/verify phone or email on an already-authenticated account ────────────

auth.post('/phone/request-otp', authMiddleware, zValidator('json', RequestOTPSchema), async (c) => {
  const { phone } = c.req.valid('json')
  const userId = c.get('userId')

  const existing = await db.user.findUnique({ where: { phone } })
  if (existing && existing.id !== userId) {
    return c.json({ error: 'This phone number is already linked to another account', code: 'VALIDATION_ERROR' }, 409)
  }

  try {
    const code = await requestOtp('phone', phone, userId)
    await sendOTP(phone, code)
    return c.json({ data: { success: true, expiresIn: 300 } })
  } catch (e) {
    if (e instanceof OtpRateLimitError) return c.json({ error: e.message, code: 'AUTH_RATE_LIMITED' }, 429)
    throw e
  }
})

auth.post(
  '/phone/verify-otp',
  authMiddleware,
  zValidator('json', z.object({ code: z.string().length(6).regex(/^\d+$/) })),
  async (c) => {
    const { code } = c.req.valid('json')
    const userId = c.get('userId')

    const phone = await verifyOtpForUser('phone', userId, code)
    if (!phone) return c.json({ error: 'OTP expired or invalid', code: 'AUTH_OTP_INVALID' }, 400)

    try {
      const user = await db.user.update({ where: { id: userId }, data: { phone, phoneVerified: true } })
      return c.json({ data: { user, profileCompletion: profileCompletion(user) } })
    } catch {
      return c.json({ error: 'This phone number is already linked to another account', code: 'VALIDATION_ERROR' }, 409)
    }
  },
)

auth.post('/email/request-otp', authMiddleware, zValidator('json', RequestEmailOTPSchema), async (c) => {
  const { email } = c.req.valid('json')
  const userId = c.get('userId')

  const existing = await db.user.findUnique({ where: { email } })
  if (existing && existing.id !== userId) {
    return c.json({ error: 'This email is already linked to another account', code: 'VALIDATION_ERROR' }, 409)
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })

  try {
    const code = await requestOtp('email', email, userId)
    await sendOTPEmail(email, code, user.language as 'am' | 'en')
    return c.json({ data: { success: true, expiresIn: 300 } })
  } catch (e) {
    if (e instanceof OtpRateLimitError) return c.json({ error: e.message, code: 'AUTH_RATE_LIMITED' }, 429)
    throw e
  }
})

auth.post('/email/verify-otp', authMiddleware, zValidator('json', VerifyEmailOTPSchema), async (c) => {
  const { code } = c.req.valid('json')
  const userId = c.get('userId')

  const email = await verifyOtpForUser('email', userId, code)
  if (!email) return c.json({ error: 'OTP expired or invalid', code: 'AUTH_OTP_INVALID' }, 400)

  try {
    const user = await db.user.update({ where: { id: userId }, data: { email, emailVerified: true } })
    return c.json({ data: { user, profileCompletion: profileCompletion(user) } })
  } catch {
    return c.json({ error: 'This email is already linked to another account', code: 'VALIDATION_ERROR' }, 409)
  }
})

auth.delete('/session', async (c) => {
  return c.json({ data: { success: true } })
})

export default auth
