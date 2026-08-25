import { db } from './db.js'
import { hashCode, verifyCode } from './crypto.js'

export type OtpChannel = 'phone' | 'email'

const OTP_EXPIRY_MS = 5 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 3
const REQUEST_WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

export class OtpRateLimitError extends Error {}

/** Creates a fresh OTP session and returns the plaintext code to send. */
export async function requestOtp(channel: OtpChannel, target: string, userId?: string): Promise<string> {
  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS)
  const recentCount = await db.otpSession.count({
    where: { channel, target, createdAt: { gte: windowStart } },
  })
  if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
    throw new OtpRateLimitError('Too many OTP requests. Try again in 10 minutes.')
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const hashedCode = await hashCode(code)
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS)

  await db.otpSession.create({ data: { channel, target, userId, code: hashedCode, expiresAt } })
  return code
}

/** Verifies a code for a known target (unauthenticated login flow). */
export async function verifyOtp(channel: OtpChannel, target: string, code: string): Promise<boolean> {
  const session = await db.otpSession.findFirst({
    where: { channel, target, verified: false, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'desc' },
  })
  if (!session) return false

  const valid = await verifyCode(code, session.code)
  if (!valid) {
    await db.otpSession.update({ where: { id: session.id }, data: { attempts: { increment: 1 } } })
    return false
  }
  await db.otpSession.update({ where: { id: session.id }, data: { verified: true } })
  return true
}

/** Verifies a code for the most recent pending session belonging to an authenticated user; returns the target (phone/email) on success. */
export async function verifyOtpForUser(channel: OtpChannel, userId: string, code: string): Promise<string | null> {
  const session = await db.otpSession.findFirst({
    where: { channel, userId, verified: false, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'desc' },
  })
  if (!session) return null

  const valid = await verifyCode(code, session.code)
  if (!valid) {
    await db.otpSession.update({ where: { id: session.id }, data: { attempts: { increment: 1 } } })
    return null
  }
  await db.otpSession.update({ where: { id: session.id }, data: { verified: true } })
  return session.target
}
