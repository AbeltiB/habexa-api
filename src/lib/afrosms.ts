export async function sendOTP(phone: string, code: string): Promise<void> {
  const res = await fetch('https://api.afrosms.com/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AFROSMS_API_KEY}`,
    },
    body: JSON.stringify({
      to: phone,
      from: process.env.AFROSMS_SENDER_ID ?? 'HABEXA',
      message: `Your Habexa verification code is: ${code}. It expires in 5 minutes.`,
    }),
  })

  if (!res.ok) {
    throw new Error(`AfroSMS error: ${res.status} ${await res.text()}`)
  }
}
