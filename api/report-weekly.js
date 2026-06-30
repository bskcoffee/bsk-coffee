// api/report-weekly.js — Vercel Cron: จันทร์ 13:00 ไทย (06:00 UTC)
import { runWeeklyReport } from './report-send.js'

export default async function handler(req, res) {
  try {
    const result = await runWeeklyReport()
    return res.status(200).json(result)
  } catch (err) {
    console.error('[Weekly Report]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
