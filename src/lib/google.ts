import { OAuth2Client } from 'google-auth-library'

let _client: OAuth2Client | null = null

function getClient(): OAuth2Client {
  if (_client) return _client
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured')
  _client = new OAuth2Client(clientId)
  return _client
}

export interface GooglePayload {
  googleId: string
  email: string
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
}

/** Verifies a Google Identity Services ID token (the `credential` from the Sign in with Google button). */
export async function verifyGoogleCredential(credential: string): Promise<GooglePayload> {
  const client = getClient()
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  })

  const payload = ticket.getPayload()
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google credential')
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    displayName: payload.name ?? null,
    avatarUrl: payload.picture ?? null,
  }
}
