# habexa-api — CLAUDE.md

## What this repo is

The REST API server for Habexa. It is the single backend that serves all clients: `habexa-web`, `habexa-admin`, and `habexa-mobile`. It handles authentication, business logic, and database access. Background jobs are handled by `habexa-worker` (separate repo, same Railway service).

**URL:** `https://api.habexa.com`
**Runtime:** Node.js 20 LTS on Railway
**Framework:** Hono.js

---

## Stack

| Dependency | Version | Purpose |
|-----------|---------|---------|
| hono | ^4.x | HTTP framework |
| @hono/zod-validator | ^0.x | Request validation middleware |
| @prisma/client | ^5.x | Database ORM |
| @habexa/sdk | latest | Shared types and validators |
| jsonwebtoken / hono/jwt | built-in | JWT signing and verification |
| bcryptjs | ^2.x | OTP hashing |
| web-push | ^3.x | Browser push notifications |
| ioredis | ^5.x | Redis client |

---

## Repo Structure

```
habexa-api/
├── src/
│   ├── index.ts                  Entry point — Hono app, middleware, route mounting
│   ├── routes/
│   │   ├── auth.ts               POST /auth/request-otp, /auth/verify-otp, DELETE /auth/session
│   │   ├── user.ts               GET|PUT /api/user/me, POST /api/user/onboarding
│   │   ├── modules.ts            GET /api/modules, GET /api/modules/:slug, POST progress + quiz
│   │   ├── paper.ts              GET|POST /api/paper/account|/trade|/trades|/reset
│   │   ├── market.ts             GET /api/market/stocks, /:symbol, /movers
│   │   ├── leaderboard.ts        GET /api/leaderboard, /history
│   │   ├── watchlist.ts          GET|POST|DELETE /api/watchlist/:symbol
│   │   ├── alerts.ts             GET|POST|DELETE /api/alerts/:id
│   │   ├── subscription.ts       GET|POST|DELETE /api/subscription
│   │   ├── push.ts               POST /api/push/subscribe, /unsubscribe
│   │   └── admin.ts              All /admin/* routes (price update, module CRUD, sub confirm)
│   ├── middleware/
│   │   ├── auth.ts               JWT verification → sets userId, isPremium on context
│   │   ├── admin.ts              Admin secret cookie verification
│   │   ├── premium.ts            Blocks route if user is not premium
│   │   └── rate-limit.ts         Redis-backed per-user rate limiting
│   ├── lib/
│   │   ├── db.ts                 Prisma client singleton
│   │   ├── redis.ts              Upstash Redis client singleton
│   │   ├── afrosms.ts            sendOTP(phone, code) → void
│   │   ├── push.ts               sendPushNotification(sub, payload) → void
│   │   ├── resend.ts             sendEmail(to, subject, html) → void (admin alerts)
│   │   └── crypto.ts             hashCode, verifyCode (OTP hashing)
│   └── prisma/
│       └── schema.prisma         Database schema (source of truth)
├── prisma/
│   ├── schema.prisma             (symlink or copy of src/prisma/schema.prisma)
│   └── migrations/               Prisma migration history
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Routes Reference

### Public Routes (no auth)

```
POST   /auth/request-otp
       Body: { phone: string }           // +251XXXXXXXXX
       Response: { data: { success: true, expiresIn: 300 } }
       Rate limit: 3 requests per phone per 10 minutes

POST   /auth/verify-otp
       Body: { phone: string, code: string }
       Response: { data: { token: string, user: User, isNewUser: boolean } }

GET    /health
       Response: { status: "ok", ts: number }
```

### Protected Routes (Bearer JWT required)

```
GET    /api/user/me
PUT    /api/user/me                      Body: { displayName?, language?, avatarUrl? }
POST   /api/user/onboarding             Body: { displayName, language, level, goal }
GET    /api/user/stats

GET    /api/modules                      Query: ?track=foundation|intermediate|advanced
GET    /api/modules/:slug
POST   /api/modules/:slug/progress      Body: { status?, videoPosition? }
POST   /api/modules/:slug/quiz          Body: { answers: number[] }

GET    /api/paper/account               Returns PaperAccountSummary
GET    /api/paper/trades                Query: ?page=1&pageSize=20
POST   /api/paper/trade                 Body: { symbol, side, quantity }
POST   /api/paper/reset

GET    /api/market/stocks               All ESX stocks with current prices
GET    /api/market/stocks/:symbol       Single stock detail
GET    /api/market/movers               Top 3 gainers and losers

GET    /api/leaderboard                 Current week top 10 + requesting user's rank
GET    /api/leaderboard/history         User's past 12 weeks

GET    /api/watchlist
POST   /api/watchlist/:symbol
DELETE /api/watchlist/:symbol

GET    /api/alerts
POST   /api/alerts                      Body: { symbol, condition: 'above'|'below', targetPrice: number }
DELETE /api/alerts/:id

GET    /api/subscription
POST   /api/subscription/initiate       Body: { plan: 'monthly'|'annual', paymentMethod }
DELETE /api/subscription

POST   /api/push/subscribe              Body: { endpoint, p256dh, auth }
DELETE /api/push/subscribe
```

### Admin Routes (admin cookie required)

```
GET    /admin/dashboard                 Aggregate stats for admin overview
GET    /admin/users                     Query: ?page&search&isPremium
GET    /admin/users/:id

GET    /admin/modules
POST   /admin/modules                   Create new module
PUT    /admin/modules/:id               Update module
DELETE /admin/modules/:id
POST   /admin/modules/:id/publish
POST   /admin/modules/:id/unpublish

GET    /admin/prices                    All stocks with last update time
PUT    /admin/prices                    Body: StockPriceUpdate[] (bulk update)
POST   /admin/prices/csv               Multipart CSV upload

GET    /admin/subscriptions             Query: ?status=pending|active|expired
POST   /admin/subscriptions/:id/confirm
POST   /admin/subscriptions/:id/reject

POST   /admin/push/broadcast           Send push to user segment
GET    /admin/push/history
```

---

## Database Schema

The Prisma schema is the source of truth. Never write raw SQL unless Prisma cannot express it.

Key schema rules:
- All monetary values: `BigInt` (santims, never ETB floats)
- All IDs: `String @id @default(cuid())` — use CUID not UUID
- All timestamps: `DateTime @default(now())` — Prisma handles UTC
- Soft delete: not used — hard delete with audit log where needed
- Never modify migration files after they have been applied to production

```prisma
// src/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id @default(cuid())
  phone           String    @unique
  displayName     String?
  language        String    @default("am")
  level           String    @default("beginner")
  goal            String?
  avatarUrl       String?
  isPremium       Boolean   @default(false)
  referralCode    String    @unique
  referredById    String?
  referredBy      User?     @relation("Referrals", fields: [referredById], references: [id])
  referrals       User[]    @relation("Referrals")
  createdAt       DateTime  @default(now())
  lastSeenAt      DateTime  @default(now())

  otpSessions       OtpSession[]
  moduleProgress    UserModuleProgress[]
  paperAccount      PaperAccount?
  watchlistItems    WatchlistItem[]
  priceAlerts       PriceAlert[]
  subscription      Subscription?
  pushSubscriptions PushSubscription[]
  leaderboardSnaps  LeaderboardSnapshot[]

  @@map("users")
}

model OtpSession {
  id         String   @id @default(cuid())
  phone      String
  code       String
  expiresAt  DateTime
  verified   Boolean  @default(false)
  attempts   Int      @default(0)
  createdAt  DateTime @default(now())
  user       User?    @relation(fields: [phone], references: [phone])

  @@index([phone, createdAt])
  @@map("otp_sessions")
}

model Subscription {
  id                String    @id @default(cuid())
  userId            String    @unique
  user              User      @relation(fields: [userId], references: [id])
  status            String    @default("active")
  plan              String    @default("monthly")
  startedAt         DateTime  @default(now())
  currentPeriodEnd  DateTime
  paymentMethod     String?
  paymentReference  String?
  cancelledAt       DateTime?
  createdAt         DateTime  @default(now())

  @@map("subscriptions")
}

model Module {
  id            String   @id @default(cuid())
  slug          String   @unique
  titleAm       String
  titleEn       String
  descriptionAm String?
  descriptionEn String?
  type          String
  track         String
  orderIndex    Int
  isPremium     Boolean  @default(false)
  durationMin   Int?
  videoUrl      String?
  contentAm     String?
  contentEn     String?
  thumbnailUrl  String?
  isPublished   Boolean  @default(false)
  createdAt     DateTime @default(now())

  quizQuestions  QuizQuestion[]
  userProgress   UserModuleProgress[]

  @@index([track, orderIndex])
  @@map("modules")
}

model QuizQuestion {
  id             String  @id @default(cuid())
  moduleId       String
  module         Module  @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  questionAm     String
  questionEn     String
  optionsAm      Json
  optionsEn      Json
  correctIndex   Int
  explanationAm  String?
  explanationEn  String?
  orderIndex     Int

  @@index([moduleId, orderIndex])
  @@map("quiz_questions")
}

model UserModuleProgress {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  moduleId      String
  module        Module    @relation(fields: [moduleId], references: [id])
  status        String    @default("not_started")
  quizScore     Int?
  quizAttempts  Int       @default(0)
  videoPosition Int       @default(0)
  completedAt   DateTime?
  lastAccessed  DateTime  @default(now())

  @@unique([userId, moduleId])
  @@map("user_module_progress")
}

model StockPrice {
  id            String   @id @default(cuid())
  symbol        String
  nameEn        String
  nameAm        String
  sector        String?
  currentPrice  BigInt
  previousClose BigInt
  openPrice     BigInt?
  dayHigh       BigInt?
  dayLow        BigInt?
  volume        BigInt   @default(0)
  tradingDate   DateTime @db.Date
  updatedAt     DateTime @updatedAt

  @@unique([symbol, tradingDate])
  @@index([symbol])
  @@map("stock_prices")
}

model PaperAccount {
  id           String    @id @default(cuid())
  userId       String    @unique
  user         User      @relation(fields: [userId], references: [id])
  cashBalance  BigInt    @default(5000000)
  initialValue BigInt    @default(5000000)
  resetCount   Int       @default(0)
  lastResetAt  DateTime?
  createdAt    DateTime  @default(now())

  trades   PaperTrade[]
  holdings PaperHolding[]

  @@map("paper_accounts")
}

model PaperTrade {
  id           String   @id @default(cuid())
  accountId    String
  account      PaperAccount @relation(fields: [accountId], references: [id])
  symbol       String
  side         String
  quantity     Int
  priceAtExec  BigInt
  totalValue   BigInt
  executedAt   DateTime @default(now())

  @@index([accountId, executedAt(sort: Desc)])
  @@map("paper_trades")
}

model PaperHolding {
  id           String   @id @default(cuid())
  accountId    String
  account      PaperAccount @relation(fields: [accountId], references: [id])
  symbol       String
  quantity     Int
  avgCostBasis BigInt
  updatedAt    DateTime @updatedAt

  @@unique([accountId, symbol])
  @@map("paper_holdings")
}

model WatchlistItem {
  id       String   @id @default(cuid())
  userId   String
  user     User     @relation(fields: [userId], references: [id])
  symbol   String
  addedAt  DateTime @default(now())

  @@unique([userId, symbol])
  @@map("watchlist_items")
}

model PriceAlert {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  symbol      String
  condition   String
  targetPrice BigInt
  isActive    Boolean   @default(true)
  triggeredAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([isActive])
  @@map("price_alerts")
}

model LeaderboardSnapshot {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id])
  weekStart      DateTime @db.Date
  portfolioValue BigInt
  returnPct      Decimal  @db.Decimal(8, 4)
  rank           Int?
  createdAt      DateTime @default(now())

  @@unique([userId, weekStart])
  @@index([weekStart, returnPct(sort: Desc)])
  @@map("leaderboard_snapshots")
}

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())

  @@map("push_subscriptions")
}
```

---

## Middleware Behavior

### `authMiddleware`
- Reads `Authorization: Bearer <token>` header
- Verifies JWT signature with `JWT_SECRET`
- Sets `c.set('userId', payload.sub)` and `c.set('isPremium', payload.isPremium)`
- Returns 401 if missing, malformed, or expired

### `adminMiddleware`
- Reads `habexa_admin` cookie
- Compares value to `ADMIN_SECRET` env var (constant-time comparison)
- Returns 403 if not present or mismatch
- Applied to all `/admin/*` routes after `authMiddleware`

### `premiumMiddleware`
- Reads `isPremium` from Hono context (set by authMiddleware)
- Returns `{ error: "Premium required", code: "MODULE_LOCKED" }` with 403 if false
- Applied selectively to premium-only routes

### `rateLimitMiddleware`
- Key: `ratelimit:{userId}:{method}:{path}`
- Uses Redis INCR + EXPIRE pattern
- Per-route limits defined in config map
- Returns 429 with `Retry-After` header when exceeded

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/habexa?schema=public

# Redis (Upstash)
UPSTASH_REDIS_URL=rediss://default:token@host:port
UPSTASH_REDIS_TOKEN=your-token

# Auth
JWT_SECRET=minimum-32-character-random-secret-here
ADMIN_SECRET=separate-admin-dashboard-secret

# Afro SMS
AFROSMS_API_KEY=your-key
AFROSMS_SENDER_ID=HABEXA

# Web Push (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:admin@habexa.com

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_STREAM_API_TOKEN=your-token
CLOUDFLARE_R2_ACCESS_KEY=your-key
CLOUDFLARE_R2_SECRET_KEY=your-secret
CLOUDFLARE_R2_BUCKET=habexa-media

# Resend (email)
RESEND_API_KEY=your-key
ADMIN_EMAIL=admin@habexa.com

# App
NODE_ENV=production
PORT=8080
API_URL=https://api.habexa.com
WEB_URL=https://habexa.com

# Telebirr (Phase 2 — leave blank until needed)
TELEBIRR_APP_ID=
TELEBIRR_API_KEY=
```

---

## Key Business Logic Rules

**OTP:**
- Code is 6 digits, numeric only
- Store HASHED (bcrypt) — never plain text
- Expires in 5 minutes
- Max 5 wrong attempts before session invalidated
- Max 3 OTP requests per phone per 10 minutes

**Paper Trading:**
- All trade execution must happen inside a `db.$transaction()` — never partial writes
- BUY: deduct from cashBalance, add to holding, update avgCostBasis weighted average
- SELL: add to cashBalance, reduce holding quantity, delete holding if quantity reaches 0
- Reset: allowed once per 30 days, deletes all holdings, restores cashBalance to 5_000_000
- Always use latest `tradingDate` price from `StockPrice` table — never accept client-sent prices

**Modules:**
- Premium check happens in the route: if `module.isPremium && !c.get('isPremium')` → 403
- Quiz: score = (correct / total) × 100, pass threshold = 60
- Progress is upserted not created — a user can access a module multiple times

**Leaderboard:**
- Only premium users appear on leaderboard
- Rank by `returnPct` descending
- Snapshot created by worker every Sunday 11:59pm EAT — not on-demand

---

## Commands

```bash
npm run dev           # Start with hot reload (tsx watch)
npm run build         # tsc compile to dist/
npm run start         # Run compiled dist/index.js
npm run db:migrate    # prisma migrate dev
npm run db:push       # prisma db push (dev only, skips migration history)
npm run db:studio     # prisma studio (visual DB browser)
npm run db:generate   # prisma generate (after schema changes)
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
```
