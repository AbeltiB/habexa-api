import { db } from './db.js'

const SINGLETON_ID = 'auth_settings_singleton'

/** Gets the one AuthSettings row, creating it with all methods enabled if it doesn't exist yet. */
export async function getAuthSettings() {
  return db.authSettings.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  })
}

export class AuthSettingsError extends Error {}

export async function updateAuthSettings(data: {
  phoneAuthEnabled?: boolean
  googleAuthEnabled?: boolean
  telegramAuthEnabled?: boolean
}) {
  const current = await getAuthSettings()
  const next = { ...current, ...data }
  if (!next.phoneAuthEnabled && !next.googleAuthEnabled && !next.telegramAuthEnabled) {
    throw new AuthSettingsError('At least one sign-in method must stay enabled')
  }
  return db.authSettings.update({ where: { id: SINGLETON_ID }, data })
}
