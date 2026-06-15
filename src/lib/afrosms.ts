export async function sendOTP(phone: string, code: string): Promise<void> {
  const url = process.env.AFROSMS_OTP_URL
  if (!url) throw new Error('AFROSMS_OTP_URL is not configured')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AFROSMS_TOKEN}`,
    },
    body: JSON.stringify({
      to: phone,
      from: process.env.AFROSMS_OTP_FROM,
      sender: process.env.AFROSMS_OTP_SENDER,
      message: `Your Habexa verification code is: ${code}. Valid for 5 minutes. Do not share this code.`,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AfroSMS error ${res.status}: ${text}`)
  }
}
