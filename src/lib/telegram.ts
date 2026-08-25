import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { TelegramAuthInput } from '@habexa/sdk'

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60

/**
 * Verifies the Telegram Login Widget payload per
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(data: TelegramAuthInput): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured')

  const { hash, ...rest } = data
  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${(rest as Record<string, unknown>)[key]}`)
    .join('\n')

  const secretKey = createHash('sha256').update(botToken).digest()
  const computedHash = createHmac('sha256', secretKey).update(checkString).digest('hex')

  const a = Buffer.from(computedHash)
  const b = Buffer.from(hash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid Telegram authentication hash')
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - data.auth_date
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    throw new Error('Telegram authentication has expired')
  }
}
