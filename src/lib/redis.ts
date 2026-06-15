import { Redis } from 'ioredis'

if (!process.env.UPSTASH_REDIS_URL) {
  throw new Error('UPSTASH_REDIS_URL is required')
}

export const redis = new Redis(process.env.UPSTASH_REDIS_URL)
