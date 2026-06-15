import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

let _transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (_transporter) return _transporter
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
  return _transporter
}

export interface Attachment {
  filename: string
  content: Buffer | string
  contentType?: string
  path?: string
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: Attachment[]
}

const DEFAULT_FROM = () =>
  process.env.SMTP_FROM ?? `Habexa <noreply@habexa.com>`

const BRAND_COLOR = '#16a34a'

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)">
          <tr>
            <td style="background:${BRAND_COLOR};padding:20px 32px">
              <span style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:-0.5px">Habexa</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-align:center">
              © ${new Date().getFullYear()} Habexa · Ethiopian Securities Exchange Education · Paper trading only
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─── Core send ────────────────────────────────────────────────────────────────

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const t = getTransporter()
  await t.sendMail({
    from: opts.from ?? DEFAULT_FROM(),
    to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo,
    attachments: opts.attachments,
  })
}

// ─── OTP email ────────────────────────────────────────────────────────────────

export async function sendOTPEmail(
  to: string,
  code: string,
  language: 'am' | 'en' = 'am',
): Promise<void> {
  const isAm = language === 'am'
  const subject = isAm ? 'የሃቤዛ ማረጋገጫ ኮድ' : 'Your Habexa verification code'

  const html = baseTemplate(
    subject,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#111">${isAm ? 'ማረጋገጫ ኮድ' : 'Verification Code'}</h2>
     <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6">
       ${isAm ? 'የሃቤዛ ማረጋገጫ ኮድዎ:' : 'Your Habexa verification code is:'}
     </p>
     <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;text-align:center;margin:0 0 24px">
       <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:${BRAND_COLOR}">${code}</span>
     </div>
     <p style="margin:0;font-size:13px;color:#6b7280">
       ${isAm ? 'ኮዱ ለ5 ደቂቃ ብቻ ይሰራል። ከማንም ጋር አይጋሩ።' : 'This code expires in 5 minutes. Do not share it with anyone.'}
     </p>`,
  )

  await sendEmail({ to, subject, html })
}

// ─── Welcome email ────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(
  to: string,
  opts: { displayName: string | null; language: 'am' | 'en' },
): Promise<void> {
  const isAm = opts.language === 'am'
  const name = opts.displayName ?? (isAm ? 'ተጠቃሚ' : 'there')
  const subject = isAm ? `እንኳን ወደ ሃቤዛ ደህና መጡ!` : `Welcome to Habexa!`

  const html = baseTemplate(
    subject,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#111">${isAm ? `ሰላም ${name}!` : `Hi ${name}!`}</h2>
     <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7">
       ${isAm
         ? 'ወደ ሃቤዛ ደህና መጡ — የኢትዮጵያ የካፒታል ገበያ ትምህርት እና ወረቀት ንግድ መሳሪያዎ።'
         : 'Welcome to Habexa — your Ethiopian capital market education and paper trading platform.'}
     </p>
     <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7">
       ${isAm
         ? 'ሙሉ ትምህርቶቻቸንን ለማግኘት ወደ ሃቤዛ ይመለሱ። ወረቀት ንግዱ ሙሉ ለሙሉ ነፃ ነው!'
         : 'Start with our free modules and paper trade with ETB 50,000 virtual cash — totally risk-free!'}
     </p>
     <a href="${process.env.WEB_URL ?? 'https://habexa.com'}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;font-weight:bold;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px">
       ${isAm ? 'አሁን ጀምር' : 'Start Learning'}
     </a>`,
  )

  await sendEmail({ to, subject, html })
}

// ─── Subscription confirmation ────────────────────────────────────────────────

export async function sendSubscriptionConfirmedEmail(
  to: string,
  opts: {
    displayName: string | null
    plan: string
    expiresAt: Date
    language: 'am' | 'en'
  },
): Promise<void> {
  const isAm = opts.language === 'am'
  const name = opts.displayName ?? (isAm ? 'ተጠቃሚ' : 'there')
  const subject = isAm ? 'ፕሪሚየም ደንበኝነት ምዝገባዎ ተረጋግጧል!' : 'Your Habexa Premium subscription is active!'
  const expiry = opts.expiresAt.toLocaleDateString(isAm ? 'am-ET' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const html = baseTemplate(
    subject,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#111">
       ${isAm ? '🎉 ፕሪሚየም ደንበኛ ሆኑ!' : '🎉 You are now Premium!'}
     </h2>
     <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7">
       ${isAm ? `ሰላም ${name}! ምዝገባዎ ተረጋግጧል።` : `Hi ${name}! Your subscription has been confirmed.`}
     </p>
     <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 24px">
       <tr>
         <td style="font-size:13px;color:#374151">
           <strong>${isAm ? 'ዕቅድ:' : 'Plan:'}</strong> ${opts.plan === 'annual' ? (isAm ? 'ዓመታዊ' : 'Annual') : (isAm ? 'ወርሃዊ' : 'Monthly')}<br>
           <strong>${isAm ? 'ያበቃበት:' : 'Expires:'}</strong> ${expiry}
         </td>
       </tr>
     </table>
     <a href="${process.env.WEB_URL ?? 'https://habexa.com'}/learn" style="display:inline-block;background:${BRAND_COLOR};color:#fff;font-weight:bold;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px">
       ${isAm ? 'ሁሉንም ትምህርቶች ይዳስሱ' : 'Explore Premium Modules'}
     </a>`,
  )

  await sendEmail({ to, subject, html })
}

// ─── Subscription rejected ────────────────────────────────────────────────────

export async function sendSubscriptionRejectedEmail(
  to: string,
  opts: { displayName: string | null; reason?: string; language: 'am' | 'en' },
): Promise<void> {
  const isAm = opts.language === 'am'
  const name = opts.displayName ?? (isAm ? 'ተጠቃሚ' : 'there')
  const subject = isAm ? 'ክፍያ ሊረጋገጥ አልቻለም' : 'Payment could not be confirmed'

  const html = baseTemplate(
    subject,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#111">
       ${isAm ? 'ክፍያ ሊረጋገጥ አልቻለም' : 'Payment not confirmed'}
     </h2>
     <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7">
       ${isAm ? `ሰላም ${name},` : `Hi ${name},`}<br><br>
       ${isAm
         ? 'የፕሪሚየም ደንበኝነት ምዝገባዎ ክፍያ ሊረጋገጥ አልቻለም። ቡድናችን ከታች ያለውን ምክንያት ጠቅሷል።'
         : 'Unfortunately, your premium subscription payment could not be confirmed.'}
     </p>
     ${opts.reason ? `<p style="margin:0 0 16px;padding:12px 16px;background:#fef2f2;border-left:4px solid #ef4444;font-size:14px;color:#374151">${opts.reason}</p>` : ''}
     <p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.7">
       ${isAm
         ? 'ሌላ ጊዜ ቢሞክሩ ወይም ከቡድናችን ጋር ይገናኙ።'
         : 'Please try again or contact our team for assistance.'}
     </p>
     <a href="${process.env.WEB_URL ?? 'https://habexa.com'}/settings" style="display:inline-block;background:${BRAND_COLOR};color:#fff;font-weight:bold;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px">
       ${isAm ? 'ዳግም ሞክር' : 'Try Again'}
     </a>`,
  )

  await sendEmail({ to, subject, html })
}

// ─── Admin notification ───────────────────────────────────────────────────────

export async function sendAdminNotification(subject: string, body: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) return

  const html = baseTemplate(
    subject,
    `<h2 style="margin:0 0 16px;font-size:18px;color:#111">${subject}</h2>
     <div style="font-size:14px;color:#374151;line-height:1.7">${body}</div>`,
  )

  await sendEmail({ to: adminEmail, subject: `[Habexa Admin] ${subject}`, html })
}

// ─── One-time / time-sensitive link ──────────────────────────────────────────

export async function sendOneTimeLinkEmail(
  to: string,
  opts: {
    subject: string
    description: string
    url: string
    expiresInMinutes: number
    language?: 'am' | 'en'
    attachments?: Attachment[]
  },
): Promise<void> {
  const isAm = opts.language === 'am'
  const expText = opts.expiresInMinutes < 60
    ? `${opts.expiresInMinutes} ${isAm ? 'ደቂቃ' : 'minutes'}`
    : `${Math.round(opts.expiresInMinutes / 60)} ${isAm ? 'ሰዓት' : 'hours'}`

  const html = baseTemplate(
    opts.subject,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#111">${opts.subject}</h2>
     <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7">${opts.description}</p>
     <a href="${opts.url}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;font-weight:bold;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;word-break:break-all">
       ${isAm ? 'ሊንኩን ክፈት' : 'Open Secure Link'}
     </a>
     <p style="margin:16px 0 0;font-size:12px;color:#6b7280">
       ${isAm ? `ይህ ሊንክ ለ${expText} ብቻ ይሰራል። ከማንም ጋር አይጋሩ።` : `This link expires in ${expText}. Do not share it.`}
     </p>`,
  )

  await sendEmail({ to, subject: opts.subject, html, attachments: opts.attachments })
}

// ─── Generic notification ─────────────────────────────────────────────────────

export async function sendNotificationEmail(
  to: string | string[],
  opts: {
    subject: string
    title: string
    body: string
    ctaText?: string
    ctaUrl?: string
    attachments?: Attachment[]
  },
): Promise<void> {
  const cta = opts.ctaText && opts.ctaUrl
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;font-weight:bold;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:20px">${opts.ctaText}</a>`
    : ''

  const html = baseTemplate(
    opts.subject,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#111">${opts.title}</h2>
     <div style="font-size:15px;color:#374151;line-height:1.7">${opts.body}</div>
     ${cta}`,
  )

  await sendEmail({ to, subject: opts.subject, html, attachments: opts.attachments })
}
