import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse/lib/pdf-parse.js')

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      || process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
// Service key bypasses RLS — ใช้สำหรับ server-side writes (GAS → Vercel → Supabase)
const SUPABASE_WRITE_KEY = process.env.SUPABASE_SERVICE_KEY  || SUPABASE_ANON_KEY
const CRON_SECRET        = process.env.CRON_SECRET

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
  // 1. Extract ISO date — prefer in-text date, fallback to filename
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
  const date = dateMatch?.[1] ?? dateFromFilename(filename) ?? null

  // 2. Detect optional columns from Thai column headers (full text scan)
  const hasExtraCommission = /ค.{0,3}าคอมมิชช.{0,3}ันเพ.{0,3}ิ่มเติม/.test(text)
  const hasMarketingFee    = /ค.{0,3}าธรรมเนียมการตลาด/.test(text)

  // 3. Find the main summary data row directly.
  //    pdf-parse concatenates all numbers in the summary row onto a single line
  //    with no spaces (e.g. "389.000.000.00-19.00-118.77-5.94-18.730.00-10.59215.970.00").
  //    NOTE: Thai text contains Private Use Area characters (U+F70x) from PDF font encoding,
  //    so section boundaries via Thai regex are unreliable — we find the row directly instead.
  const dataRowMatch = text.match(/\n(\d{3,}\.\d{2}(?:[-\d.,]+\.\d{2}){8,})\n/)
  const allNums = dataRowMatch
    ? [...dataRowMatch[1].matchAll(/-?\d{1,3}(?:,\d{3})*\.\d{2}/g)].map(m => parseFloat(m[0].replace(/,/g, '')))
    : []

  const len = allNums.length

  if (len < 9) {
    return { date, advertisement: 0, marketing_fee: 0, campaign: 0 }
  }

  // 4. Detect โฆษณา and การปรับรายได้ columns from the text immediately before the data row.
  //    This is reliable because these column headers appear on the same line as the data.
  const preRowIdx = text.indexOf('\n' + dataRowMatch[1] + '\n')
  const preRow    = preRowIdx >= 0 ? text.slice(Math.max(0, preRowIdx - 400), preRowIdx) : ''
  const hasAdvertisement = /โฆษณา/.test(preRow)
  const hasAdj           = /การปรับราย/.test(preRow)  // การปรับรายได้ (ไทยช่วยไทยพลัส)

  // 5. Calculate column index offsets.
  //    Trailing columns after mkt (from start): ส่วนลดจัดส่ง(1) + [การปรับ] + [โฆษณา] + รายรับ(1) + ค้างชำระ(1) = 3+adj+adv
  //    trailingOffset = those trailing cols + 1 (the mkt col itself) = 4 + adj + adv
  const trailingOffset = 4 + (hasAdj ? 1 : 0) + (hasAdvertisement ? 1 : 0)

  // advertisement อยู่ที่ len-3 เสมอเมื่อมีคอลัมน์ โฆษณา (ก่อน รายรับ และ ค้างชำระ เสมอ)
  const advertisement = hasAdvertisement ? Math.abs(allNums[len - 3] || 0) : 0

  let marketing_fee = 0
  let campaign      = 0

  if (hasMarketingFee && hasExtraCommission) {
    campaign      = Math.abs(allNums[len - trailingOffset - 1] || 0)
    marketing_fee = Math.abs(allNums[len - trailingOffset]     || 0)
  } else if (hasMarketingFee) {
    marketing_fee = Math.abs(allNums[len - trailingOffset] || 0)
  } else if (hasExtraCommission) {
    campaign = Math.abs(allNums[len - trailingOffset] || 0)
  }

  return { date, advertisement, marketing_fee, campaign }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function saveCosts(date, advertisement, marketing_fee, campaign) {
  // ใช้ service key เพื่อ bypass RLS (server-side only — ไม่ expose ฝั่ง client)
  const readHeaders = {
    apikey:        SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
  const writeHeaders = {
    apikey:        SUPABASE_WRITE_KEY,
    Authorization: `Bearer ${SUPABASE_WRITE_KEY}`,
    'Content-Type': 'application/json',
    Prefer:        'return=minimal',
  }

  // Check if row exists (read — anon key ok)
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.GRAB&select=id`,
    { headers: readHeaders }
  )
  const existing = await checkRes.json()

  if (existing?.length > 0) {
    // PATCH only the 3 cost columns — leave menu_discount, delivery_discount intact
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs?date=eq.${date}&platform=eq.GRAB`,
      {
        method:  'PATCH',
        headers: writeHeaders,
        body: JSON.stringify({ advertisement, marketing_fee, campaign }),
      }
    )
    if (!patchRes.ok) {
      const errText = await patchRes.text()
      throw new Error(`PATCH failed ${patchRes.status}: ${errText}`)
    }
    return 'updated'
  } else {
    // INSERT new row (user hasn't manually entered yet)
    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_costs`,
      {
        method:  'POST',
        headers: writeHeaders,
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
