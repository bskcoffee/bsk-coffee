import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse/lib/pdf-parse.js')

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET       = process.env.CRON_SECRET

// ── Auth helper ──────────────────────────────────────────────────────────────

function isAuthorized(req) {
  const header = req.headers['x-parse-secret']
  const body   = req.body?.secret
  return header === CRON_SECRET || body === CRON_SECRET
}

// ── PDF Parser ───────────────────────────────────────────────────────────────
//
// Grab daily report PDF summary row column order:
//   ยอดรายการ | VAT | ค่าบริการ | โปรโมชันร้าน | ค่าคอมมิชชัน
//   [ค่าคอมมิชชันเพิ่มเติม]  ← optional (campaign)
//   [ค่าธรรมเนียมการตลาด]    ← optional (marketing_fee)
//   ส่วนลดจัดส่ง | การปรับรายได้ | โฆษณา | รายรับทั้งหมด | ค้างชำระ Grab
//
// Last 3 columns are ALWAYS: โฆษณา, รายรับทั้งหมด, ค้างชำระ
// → advertisement = values[len-3]
// → marketing_fee = values[len-6]  (if column present)
// → campaign      = values[len-7]  (if both optional columns present)

function dateFromFilename(filename) {
  // filename: "3-C62HVAWZGUNWVN-20260524.pdf" → "2026-05-24"
  const m = filename && filename.match(/(\d{8})(?:\.\w+)?$/)
  if (!m) return null
  const s = m[1]
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function parseGrabReport(text, filename) {
  // 1. Extract ISO date — prefer ADS section ("2026-05-24"), fallback to filename
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
  const date = dateMatch?.[1] ?? dateFromFilename(filename) ?? null

  // 2. Detect optional columns from Thai column headers
  const hasExtraCommission = /ค.{0,3}าคอมมิชช.{0,3}ันเพ.{0,3}ิ่มเติม/.test(text)
  const hasMarketingFee    = /ค.{0,3}าธรรมเนียมการตลาด/.test(text)

  // 3. Find all decimal numbers in the summary section
  //    Section: from "ยอดรายการ" header to start of "รายได้จากไทยช่วยไทย" section
  const secStart = text.search(/ยอดรายการ\s*VAT|ยอดรายการVAT/)
  const secEnd   = text.search(/รายไดจากไทยชวยไทยพลัส|รายไดจากไทย/)
  const section  = (secStart !== -1 && secEnd > secStart)
    ? text.slice(secStart, secEnd)
    : text

  // 4. Detect advertisement column from section only (not full text —
  //    "โฆษณา" also appears in definitions on page 2 even when no ads that day)
  const hasAdvertisement = /โฆษณา/.test(section)

  // Extract all decimal numbers from the section (values like -631.00, 1,012.94)
  const numMatches = [...section.matchAll(/-?\d{1,3}(?:,\d{3})*\.\d{2}/g)]
  const allNums    = numMatches.map(m => parseFloat(m[0].replace(/,/g, '')))

  // Base columns: 9 without โฆษณา, 10 with โฆษณา
  // Full format: ยอดรายการ | VAT | ค่าบริการ | โปรโมชันร้าน | ค่าคอมมิชชัน
  //              [ค่าคอมมิชชันเพิ่มเติม] [ค่าธรรมเนียมการตลาด]
  //              ส่วนลดจัดส่ง | การปรับรายได้ | [โฆษณา] | รายรับทั้งหมด | ค้างชำระ
  const baseColumns = 9 + (hasAdvertisement ? 1 : 0)
  const expectedLen = baseColumns + (hasMarketingFee ? 1 : 0) + (hasExtraCommission ? 1 : 0)

  // Take last expectedLen numbers — they form the data row
  const values = allNums.slice(-expectedLen)
  const len    = values.length

  if (len < 9) {
    // Fallback: couldn't find enough numbers, try THB- pattern for advertisement
    const advertMatch = text.match(/โฆษณา[\s\S]{0,600}?THB-([0-9,]+\.[0-9]+)/)
    const advertisement = advertMatch ? parseFloat(advertMatch[1].replace(/,/g, '')) : 0
    return { date, advertisement, marketing_fee: 0, campaign: 0 }
  }

  // advertisement อยู่ที่ len-3 เมื่อมีคอลัมน์ โฆษณา, ถ้าไม่มีให้ = 0
  const advertisement = hasAdvertisement ? Math.abs(values[len - 3] || 0) : 0

  // adv = 1 ชดเชย index เมื่อไม่มีคอลัมน์ โฆษณา
  const adv = hasAdvertisement ? 0 : 1

  let marketing_fee = 0
  let campaign      = 0

  if (hasMarketingFee && hasExtraCommission) {
    campaign      = Math.abs(values[len - 7 + adv] || 0)
    marketing_fee = Math.abs(values[len - 6 + adv] || 0)
  } else if (hasMarketingFee) {
    marketing_fee = Math.abs(values[len - 6 + adv] || 0)
  } else if (hasExtraCommission) {
    campaign = Math.abs(values[len - 6 + adv] || 0)
  }

  return { date, advertisement, marketing_fee, campaign }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function saveCosts(date, advertisement, marketing_fee, campaign) {
  const headers = {
    apikey:        SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer:        'return=minimal',
  }

  // Check if row exists
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.GRAB&select=id`,
    { headers }
  )
  const existing = await checkRes.json()

  if (existing?.length > 0) {
    // PATCH only the 3 cost columns — leave menu_discount, delivery_discount intact
    await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.GRAB`,
      {
        method:  'PATCH',
        headers,
        body: JSON.stringify({ advertisement, marketing_fee, campaign }),
      }
    )
    return 'updated'
  } else {
    // INSERT new row (user hasn't manually entered yet)
    await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs`,
      {
        method:  'POST',
        headers,
        body: JSON.stringify({
          date,
          platform:          'GRAB',
          menu_discount:     0,
          campaign,
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

  const { pdfBase64, saveToDb = false, filename } = req.body ?? {}
  if (!pdfBase64) return res.status(400).json({ error: 'missing pdfBase64' })

  try {
    const buffer        = Buffer.from(pdfBase64, 'base64')
    const { text }      = await pdfParse(buffer)
    const parsed        = parseGrabReport(text, filename)

    if (saveToDb && parsed.date) {
      const action = await saveCosts(
        parsed.date,
        parsed.advertisement,
        parsed.marketing_fee,
        parsed.campaign
      )
      return res.status(200).json({ ...parsed, action })
    }

    return res.status(200).json(parsed)
  } catch (err) {
    console.error('[parse-grab-pdf]', err)
    return res.status(500).json({ error: err.message })
  }
}
