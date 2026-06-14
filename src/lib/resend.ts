export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Habexa Admin <noreply@habexa.com>',
      to,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    throw new Error(`Resend error: ${res.status} ${await res.text()}`)
  }
}
