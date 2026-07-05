// parse-lineman-email.js
// Parses LINE MAN Wongnai daily report email body and saves costs to Supabase
//
// Fields extracted:
//   marketing_fee  ← ค่าบริการ GP (รวม VAT)
//   advertisement  ← ค่าบริการโฆษณา (รวม VAT)
//
// POST body: { emailText, subject, saveToDb }
// Header:    x-parse-secret = CRON_SECRET

const SUPABASE_URL       = process.env.VITE_SUPABASE_URL      || process.env.SUPABASE_URL
const SUPABASE_ANON_KEY  = process.env.VITE_SUPABASE_ANON_KEY
// Service key bypasses RLS — used for server-side writes
const SUPABASE_WRITE_KEY = process.env.SUPABASE_SERVICE_KEY   || SUPABASE_ANON_KEY
const CRON_SECRET        = process.env.CRON_SECRET

// ── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req) {
  const header = req.headers['x-parse-secret']
  const body   = req.body?.secret
  return header === CRON_SECRET || body === CRON_SECRET
}

// ── Date parsing ──────────────────────────────────────────────────────────────
//
// Subject format: "รายงานยอดขายรายวัน - LINE MAN Wongnai 01/07/69"
// → day=01, month=07, shortYear=69 → thaiYear=2569 → adYear=2026 → "2026-07-01"

function parseDateFromSubject(subject) {
  const m = (subject ?? '').match(/(\d{1,2})\/(\d{2})\/(\d{2,4})\s*$/)
  if (!m) return null
  const day      = m[1].padStart(2, '0')
  const month    = m[2]
  let thaiYear   = parseInt(m[3])
  if (thaiYear < 100) thaiYear += 2500          // 69 → 2569
  const adYear   = thaiYear - 543
  return `${adYear}-${month}-${day}`
}

// Fallback: parse "วันที่ 01 ก.ค. 2569" from email body
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
// LINE MAN email is HTML — strip tags first, then extract numbers.
// Layout (plain text after strip):
//   ค่าบริการ GP (รวม VAT)    -175.27
//   ค่าบริการโฆษณา (รวม VAT)  -110.55

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')   // remove tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

function extractAmount(text, labelPattern) {
  const re = new RegExp(labelPattern + '[\\s\\S]{0,300}?(-?[\\d,]+\\.\\d{2})')
  const m  = text.match(re)
  if (!m) return 0
  return Math.abs(parseFloat(m[1].replace(/,/g, '')))
}

function parseLineManEmail(emailText, subject) {
  const date = parseDateFromSubject(subject) ?? parseDateFromBody(emailText)

  // Strip HTML if present
  const text = emailText.includes('<') ? stripHtml(emailText) : emailText

  // ค่าบริการ GP (รวม VAT) → marketing_fee (GP commission)
  const marketing_fee = extractAmount(text, 'ค.{0,5}าบริการ\\s*GP')

  // ค่าบริการโฆษณา (รวม VAT) → advertisement
  const advertisement = extractAmount(text, 'ค.{0,5}าบริการโฆษณา')

  return { date, advertisement, marketing_fee, campaign: 0 }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function saveCosts(date, advertisement, marketing_fee) {
  const writeHeaders = {
    apikey:         SUPABASE_WRITE_KEY,
    Authorization:  `Bearer ${SUPABASE_WRITE_KEY}`,
    'Content-Type': 'application/json',
    Prefer:         'return=minimal',
  }

  // Check if row exists — ใช้ service key เพื่อ bypass RLS
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.LINE&select=id`,
    { headers: writeHeaders }
  )
  const existing = await checkRes.json()

  if (existing?.length > 0) {
    // PATCH only cost columns — leave menu_discount, delivery_discount intact
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.LINE`,
      {
        method:  'PATCH',
        headers: writeHeaders,
        body:    JSON.stringify({ advertisement, marketing_fee }),
      }
    )
    if (!patchRes.ok) {
      const errText = await patchRes.text()
      throw new Error(`PATCH failed ${patchRes.status}: ${errText}`)
    }
    return 'updated'
  } else {
    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs`,
      {
        method:  'POST',
        headers: writeHeaders,
        body:    JSON.stringify({
          date,
          platform:          'LINE',
          menu_discount:     0,
          campaign:          0,
          marketing_fee,
          delivery_discount: 0,
          advertisement,
        }),
      }
    )
    if (!postRes.ok) {
      const errText = await postRes.text()
      throw new Error(`INSERT failed ${postRes.status}: ${errText}`)
    }
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
