// api/report-monthly.js — Vercel Cron: วันที่ 1 ของเดือน 14:00 ไทย (07:00 UTC)
import { runMonthlyReport } from './report-send.js'

export default async function handler(req, res) {
  try {
    const result = await runMonthlyReport()
    return res.status(200).json(result)
  } catch (err) {
    console.error('[Monthly Report]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
