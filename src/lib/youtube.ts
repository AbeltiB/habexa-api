import { google } from 'googleapis'
import { Readable } from 'stream'

export type YouTubeVisibility = 'public' | 'unlisted' | 'private'

export interface YouTubeUploadResult {
  videoId: string
  url: string
  embedUrl: string
  status: YouTubeVisibility
}

function getOAuth2Client() {
  const clientId = process.env.YOUTUBE_CLIENT_ID
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('YouTube API credentials not configured (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)')
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

export async function uploadToYouTube(
  fileBuffer: Buffer,
  opts: {
    title: string
    description?: string
    visibility: YouTubeVisibility
    mimeType?: string
    tags?: string[]
  },
): Promise<YouTubeUploadResult> {
  const auth = getOAuth2Client()
  const yt = google.youtube({ version: 'v3', auth })

  const readable = new Readable()
  readable.push(fileBuffer)
  readable.push(null)

  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: opts.title,
        description: opts.description ?? '',
        categoryId: '27',
        tags: opts.tags ?? ['habexa', 'education', 'ethiopia'],
        defaultLanguage: 'am',
      },
      status: {
        privacyStatus: opts.visibility,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: opts.mimeType ?? 'video/*',
      body: readable,
    },
  })

  const videoId = res.data.id!
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`,
    status: opts.visibility,
  }
}

export async function updateYouTubeVisibility(
  videoId: string,
  visibility: YouTubeVisibility,
): Promise<void> {
  const auth = getOAuth2Client()
  const yt = google.youtube({ version: 'v3', auth })

  await yt.videos.update({
    part: ['status'],
    requestBody: { id: videoId, status: { privacyStatus: visibility } },
  })
}

export async function deleteFromYouTube(videoId: string): Promise<void> {
  const auth = getOAuth2Client()
  const yt = google.youtube({ version: 'v3', auth })
  await yt.videos.delete({ id: videoId })
}
