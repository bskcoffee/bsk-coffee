// parse-lineman-email.js
// Parses LINE MAN Wongnai daily report email body and saves costs to Supabase
//
// Fields extracted:
//   advertisement  ← ค่าบริการโฆษณา (รวม VAT)
//   marketing_fee  ← ค่าธรรมเนียมการตลาดจากแคมเปญโค้ดเด็ด (รวม VAT)
//
// POST body: { emailText, subject, saveToDb }
// Header:    x-parse-secret = CRON_SECRET

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET       = process.env.CRON_SECRET

// ── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req) {
  const header = req.headers['x-parse-secret']
  const body   = req.body?.secret
  return header === CRON_SECRET || body === CRON_SECRET
}

// ── Date parsing ──────────────────────────────────────────────────────────────
//
// Subject format: "รายงานยอดขายรายวัน - LINE MAN Wongnai 29/06/69"
// → day=29, month=06, shortYear=69 → thaiYear=2569 → adYear=2026 → "2026-06-29"

function parseDateFromSubject(subject) {
  const m = (subject ?? '').match(/(\d{1,2})\/(\d{2})\/(\d{2,4})\s*$/)
  if (!m) return null
  const day   = m[1].padStart(2, '0')
  const month = m[2]
  let thaiYear = parseInt(m[3])
  if (thaiYear < 100) thaiYear += 2500          // 69 → 2569
  const adYear = thaiYear - 543
  return `${adYear}-${month}-${day}`
}

// Fallback: parse "วันที่ 29 มิ.ย. 2569" from email body
const THAI_MONTHS = {
  'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04',
  'พ.ค.': '05', 'มิ.ย.': '06', 'ก.ค.': '07', 'ส.ค.': '08',
  'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12',
}

function parseDateFromBody(text) {
  const m = text.match(/วันที่\s+(\d{1,2})\s+([฀-๿.]+\.)\s+(\d{4})/)
  if (!m) return null
  const day    = m[1].padStart(2, '0')
  const month  = THAI_MONTHS[m[2]] ?? null
  if (!month) return null
  const adYear = parseInt(m[3]) - 543
  return `${adYear}-${month}-${day}`
}

// ── Email parser ──────────────────────────────────────────────────────────────
//
// Looks for a decimal number (possibly negative) after each cost label.
// Plain-text email layout is typically:
//   ค่าบริการโฆษณา (รวม VAT)  -55.28
// or the number may appear on the next line.

function extractAmount(text, labelPattern) {
  const re = new RegExp(labelPattern + '[\\s\\S]{0,200}?(-?[\\d,]+\\.\\d{2})')
  const m  = text.match(re)
  if (!m) return 0
  return Math.abs(parseFloat(m[1].replace(/,/g, '')))
}

function parseLineManEmail(emailText, subject) {
  const date = parseDateFromSubject(subject) ?? parseDateFromBody(emailText)

  // ค่าบริการโฆษณา (รวม VAT)
  const advertisement = extractAmount(emailText, 'ค.{0,5}าบริการโฆษณา')

  // ค่าธรรมเนียมการตลาดจากแคมเปญโค้ดเด็ด (รวม VAT)
  const marketing_fee = extractAmount(emailText, 'ค.{0,5}าธรรมเนียมการตลาดจากแคมเปญ')

  return { date, advertisement, marketing_fee, campaign: 0 }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function saveCosts(date, advertisement, marketing_fee) {
  const headers = {
    apikey:         SUPABASE_ANON_KEY,
    Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer:         'return=minimal',
  }

  // Check if row exists for this date + platform
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.LINEMAN&select=id`,
    { headers }
  )
  const existing = await checkRes.json()

  if (existing?.length > 0) {
    // PATCH only the cost columns — leave menu_discount, delivery_discount intact
    await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.LINEMAN`,
      {
        method:  'PATCH',
        headers,
        body:    JSON.stringify({ advertisement, marketing_fee }),
      }
    )
    return 'updated'
  } else {
    await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs`,
      {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          date,
          platform:          'LINEMAN',
          menu_discount:     0,
          campaign:          0,
          marketing_fee,
          delivery_discount: 0,
          advertisement,
        }),
      }
    )
    return 'inserted'
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isAuthorized(req))    return res.status(401).json({ error: 'unauthorized' })

  const { emailText, subject, saveToDb = false } = req.body ?? {}
  if (!emailText) return res.status(400).json({ error: 'missing emailText' })

  try {
    const parsed = parseLineManEmail(emailText, subject ?? '')

    if (saveToDb && parsed.date) {
      const action = await saveCosts(parsed.date, parsed.advertisement, parsed.marketing_fee)
      return res.status(200).json({ ...parsed, action })
    }

    return res.status(200).json(parsed)
  } catch (err) {
    console.error('[parse-lineman-email]', err)
    return res.status(500).json({ error: err.message })
  }
}
