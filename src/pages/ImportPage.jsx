import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase, getCostSettingsForDate } from '../lib/supabase'
import { calcMenuCostBreakdown, formatBaht } from '../utils/calculations'
import { useToast } from '../contexts/ToastContext'
import {
  Download, Upload, CheckCircle2, XCircle, AlertCircle,
  FileSpreadsheet, Loader2, Info, FileUp, RotateCcw,
} from 'lucide-react'

const CAMPAIGN_GP_PCT = 5

// ─── Download Template ────────────────────────────────────────────────────────
function downloadTemplate(platList) {
  const wb = XLSX.utils.book_new()

  // Sheet 1: ยอดขาย
  const salesRows = [
    ['คำแนะนำ: กรอกข้อมูลยอดขายรายวัน — ชื่อเมนูต้องตรงกับในระบบ | Campaign Y = สินค้าร่วมรายการ 60/40'],
    ['วันที่', 'Platform', 'ชื่อเมนู', 'จำนวน', 'Campaign (Y/N)'],
    ['2026-06-18', platList[0] ?? 'GRAB', 'ชื่อเมนู A', 2, 'N'],
    ['2026-06-18', platList[0] ?? 'GRAB', 'ชื่อเมนู B', 1, 'Y'],
    ['2026-06-18', platList[1] ?? 'LINE', 'ชื่อเมนู A', 3, 'N'],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(salesRows)
  ws1['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'ยอดขาย')

  // Sheet 2: ต้นทุน Platform
  const costsRows = [
    ['คำแนะนำ: กรอกค่าใช้จ่าย Platform ต่อวัน (1 แถว = 1 Platform x 1 วัน) — ช่องที่ไม่มีใส่ 0'],
    ['วันที่', 'Platform', 'ส่วนลดเมนู', 'Campaign', 'Marketing Fee', 'ส่วนลด Delivery', 'โฆษณา'],
    ['2026-06-18', platList[0] ?? 'GRAB', 0, 50, 100, 0, 0],
    ['2026-06-18', platList[1] ?? 'LINE', 0, 0, 80, 0, 0],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(costsRows)
  ws2['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 15 }, { wch: 17 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'ต้นทุน Platform')

  // Sheet 3: Platform reference
  const ws3 = XLSX.utils.aoa_to_sheet([
    ['Platform ที่ใช้ได้ในระบบ'],
    ['ชื่อ Platform'],
    ...platList.map(p => [p]),
  ])
  ws3['!cols'] = [{ wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws3, 'Platform (อ้างอิง)')

  XLSX.writeFile(wb, 'cocoa-house-import-template.xlsx')
}

// ─── Parse Excel ──────────────────────────────────────────────────────────────
function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target.result, { type: 'array' })
        const ws1 = wb.Sheets['ยอดขาย']
        const ws2 = wb.Sheets['ต้นทุน Platform']
        if (!ws1) return reject(new Error('ไม่พบ Sheet "ยอดขาย" ในไฟล์'))

        // Sales rows (skip instruction row i=0, header i=1, data starts i=2)
        const rawSales = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: '' })
        const salesData = []
        for (let i = 2; i < rawSales.length; i++) {
          const [date, platform, menuName, qty, campaign] = rawSales[i]
          if (!date && !platform && !menuName) continue
          salesData.push({
            rowNum: i + 1,
            date: String(date ?? '').trim(),
            platform: String(platform ?? '').trim(),
            menuName: String(menuName ?? '').trim(),
            qty: parseInt(qty) || 0,
            isCampaign: String(campaign ?? '').trim().toUpperCase() === 'Y',
          })
        }

        // Cost rows
        const costsData = []
        if (ws2) {
          const rawCosts = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: 0 })
          for (let i = 2; i < rawCosts.length; i++) {
            const [date, platform, menuDiscount, campaign, marketingFee, deliveryDiscount, advertisement] = rawCosts[i]
            if (!date && !platform) continue
            costsData.push({
              rowNum: i + 1,
              date: String(date ?? '').trim(),
              platform: String(platform ?? '').trim(),
              menu_discount:     parseFloat(menuDiscount)     || 0,
              campaign:          parseFloat(campaign)         || 0,
              marketing_fee:     parseFloat(marketingFee)     || 0,
              delivery_discount: parseFloat(deliveryDiscount) || 0,
              advertisement:     parseFloat(advertisement)    || 0,
            })
          }
        }
        resolve({ salesData, costsData })
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ─── Date validation ──────────────────────────────────────────────────────────
const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d))

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ImportPage() {
  const { addToast } = useToast()
  const fileInputRef = useRef(null)

  // Reference data from Supabase
  const [refData, setRefData]       = useState(null)   // { menuMap, menuCostMap, costSettings, platConfig, platSet }
  const [refLoading, setRefLoading] = useState(true)

  // File/parse state
  const [fileName, setFileName]           = useState(null)
  const [parsed, setParsed]               = useState(null)   // { salesData, costsData }
  const [validated, setValidated]         = useState(null)   // { rows, costRows, errors }
  const [importing, setImporting]         = useState(false)
  const [importResult, setImportResult]   = useState(null)   // { success, failed, details }

  // ── Load reference data ──────────────────────────────────────────────────
  useEffect(() => {
    loadRefData()
  }, [])

  async function loadRefData() {
    setRefLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)

      const [menusRes, menuCostsRes, settingsRes, costSettingsRes] = await Promise.all([
        supabase.from('menus').select('id, name, menu_prices(platform, price)').eq('is_active', true),
        supabase.from('menu_costs').select('*').is('effective_to', null),
        supabase.from('settings').select('key, value'),
        supabase.from('cost_settings').select('key, value, effective_from')
          .lte('effective_from', today).order('effective_from', { ascending: false }),
      ])

      // Platform config from settings
      const settingsMap = {}
      for (const s of (settingsRes.data ?? [])) settingsMap[s.key] = s.value
      let platConfig = []
      try { platConfig = JSON.parse(settingsMap.platforms ?? '[]') } catch {}
      if (!platConfig.length) platConfig = [
        { name: 'GRAB', fee: 30 }, { name: 'LINE', fee: 20 },
        { name: 'SHOPEE', fee: 20 }, { name: 'The metro', fee: 15 }, { name: 'TU', fee: 15 },
      ]

      // Cost settings (latest per key)
      const costSettings = {}
      for (const r of (costSettingsRes.data ?? [])) {
        if (!(r.key in costSettings)) costSettings[r.key] = r.value
      }

      // Menu name → { id, menu_prices } map
      const menuMap = {}
      for (const m of (menusRes.data ?? [])) {
        menuMap[m.name.trim()] = m
      }

      // menu_costs by menu_id
      const menuCostMap = {}
      for (const mc of (menuCostsRes.data ?? [])) {
        menuCostMap[mc.menu_id] = mc
      }

      const platSet = new Set(platConfig.map(p => p.name))

      setRefData({ menuMap, menuCostMap, costSettings, platConfig, platSet })
    } catch (err) {
      addToast('โหลดข้อมูลอ้างอิงล้มเหลว: ' + err.message, 'error')
    } finally {
      setRefLoading(false)
    }
  }

  // ── Validate parsed data ─────────────────────────────────────────────────
  function validateParsed(data, refData) {
    const { salesData, costsData } = data
    const { menuMap, platSet, platConfig, menuCostMap, costSettings } = refData
    const platFeeMap = Object.fromEntries(platConfig.map(p => [p.name, p.fee ?? 0]))
    const errors = []

    const rows = salesData.map((row) => {
      const rowErrors = []
      if (!isValidDate(row.date)) rowErrors.push('วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)')
      if (!row.platform) rowErrors.push('ไม่มีชื่อ Platform')
      else if (!platSet.has(row.platform)) rowErrors.push(`ไม่พบ Platform "${row.platform}" ในระบบ`)
      if (!row.menuName) rowErrors.push('ไม่มีชื่อเมนู')
      if (row.qty <= 0) rowErrors.push('จำนวนต้องมากกว่า 0')

      const menuRecord = menuMap[row.menuName]
      if (row.menuName && !menuRecord) rowErrors.push(`ไม่พบเมนู "${row.menuName}" ในระบบ`)

      let unitPrice = 0
      let unitGpCost = 0
      if (menuRecord && platSet.has(row.platform)) {
        const priceRow = menuRecord.menu_prices?.find(p => p.platform === row.platform)
        unitPrice = priceRow?.price ?? 0
        if (!unitPrice) rowErrors.push(`ไม่พบราคาของเมนูนี้สำหรับ ${row.platform}`)

        const mc = menuCostMap[menuRecord.id]
        if (mc) {
          const feePct = row.isCampaign ? CAMPAIGN_GP_PCT : (platFeeMap[row.platform] ?? 0)
          const bd = calcMenuCostBreakdown(mc, costSettings, unitPrice, feePct)
          unitGpCost = bd?.gpCost ?? 0
        }
      }

      if (rowErrors.length) errors.push({ sheet: 'ยอดขาย', row: row.rowNum, messages: rowErrors })

      return { ...row, menuId: menuRecord?.id ?? null, unitPrice, unitGpCost, _errors: rowErrors }
    })

    const costRows = costsData.map((row) => {
      const rowErrors = []
      if (!isValidDate(row.date)) rowErrors.push('วันที่ไม่ถูกต้อง')
      if (!row.platform) rowErrors.push('ไม่มีชื่อ Platform')
      else if (!platSet.has(row.platform)) rowErrors.push(`ไม่พบ Platform "${row.platform}"`)
      if (rowErrors.length) errors.push({ sheet: 'ต้นทุน', row: row.rowNum, messages: rowErrors })
      return { ...row, _errors: rowErrors }
    })

    return { rows, costRows, errors }
  }

  // ── Handle file drop/select ──────────────────────────────────────────────
  async function handleFile(file) {
    if (!file || !file.name.match(/\.xlsx?$/i)) {
      addToast('กรุณาเลือกไฟล์ .xlsx หรือ .xls', 'error')
      return
    }
    setFileName(file.name)
    setParsed(null)
    setValidated(null)
    setImportResult(null)
    try {
      const data = await parseExcel(file)
      setParsed(data)
      if (refData) setValidated(validateParsed(data, refData))
    } catch (err) {
      addToast('อ่านไฟล์ไม่ได้: ' + err.message, 'error')
    }
  }

  function onFileInputChange(e) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function reset() {
    setFileName(null)
    setParsed(null)
    setValidated(null)
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Import to Supabase ───────────────────────────────────────────────────
  async function handleImport() {
    if (!validated) return
    const { rows, costRows } = validated
    const validSales  = rows.filter(r => r._errors.length === 0)
    const validCosts  = costRows.filter(r => r._errors.length === 0)
    if (!validSales.length && !validCosts.length) {
      addToast('ไม่มีข้อมูลที่ถูกต้องสำหรับนำเข้า', 'error')
      return
    }
    setImporting(true)
    setImportResult(null)
    const details = []
    let successCount = 0, failCount = 0

    try {
      // Group sales rows by date + platform
      const groups = {}
      for (const row of validSales) {
        const key = `${row.date}|${row.platform}`
        if (!groups[key]) groups[key] = { date: row.date, platform: row.platform, items: [] }
        groups[key].items.push(row)
      }

      for (const [key, grp] of Object.entries(groups)) {
        try {
          // 1. Upsert order
          const { data: orderData, error: orderErr } = await supabase
            .from('orders')
            .upsert({ date: grp.date, platform: grp.platform }, { onConflict: 'date,platform' })
            .select('id')
            .single()
          if (orderErr) throw orderErr
          const orderId = orderData.id

          // 2. Delete existing order_items
          await supabase.from('order_items').delete().eq('order_id', orderId)

          // 3. Insert new order_items
          const items = grp.items.map(row => ({
            order_id:    orderId,
            menu_id:     row.menuId,
            quantity:    row.qty,
            unit_price:  row.unitPrice,
            unit_gp_cost: row.unitGpCost,
            is_campaign: row.isCampaign,
          }))
          const { error: itemsErr } = await supabase.from('order_items').insert(items)
          if (itemsErr) throw itemsErr

          details.push({ key, status: 'ok', label: `${grp.date} / ${grp.platform} (${grp.items.length} รายการ)` })
          successCount++
        } catch (err) {
          details.push({ key, status: 'error', label: `${grp.date} / ${grp.platform}`, message: err.message })
          failCount++
        }
      }

      // Upsert platform_costs
      for (const row of validCosts) {
        try {
          const { error: costErr } = await supabase
            .from('platform_costs')
            .upsert({
              date:              row.date,
              platform:          row.platform,
              menu_discount:     row.menu_discount,
              campaign:          row.campaign,
              marketing_fee:     row.marketing_fee,
              delivery_discount: row.delivery_discount,
              advertisement:     row.advertisement,
            }, { onConflict: 'date,platform' })
          if (costErr) throw costErr
        } catch (err) {
          details.push({ key: `cost-${row.date}-${row.platform}`, status: 'error',
            label: `ต้นทุน ${row.date} / ${row.platform}`, message: err.message })
          failCount++
        }
      }

      setImportResult({ success: successCount, failed: failCount, details })
      if (failCount === 0) addToast(`นำเข้าสำเร็จ ${successCount} วัน/Platform`, 'success')
      else addToast(`นำเข้า ${successCount} สำเร็จ, ${failCount} ล้มเหลว`, 'warning')
    } catch (err) {
      addToast('นำเข้าข้อมูลล้มเหลว: ' + err.message, 'error')
    } finally {
      setImporting(false)
    }
  }

  const platList = refData?.platConfig?.map(p => p.name) ?? []
  const hasErrors = validated?.errors?.length > 0
  const validSalesCount = validated?.rows?.filter(r => r._errors.length === 0).length ?? 0
  const validCostCount  = validated?.costRows?.filter(r => r._errors.length === 0).length ?? 0

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">นำเข้าข้อมูลจาก Excel</h1>
        <p className="text-gray-500 text-sm mt-1">นำเข้ายอดขายและต้นทุน Platform จากไฟล์ .xlsx จำนวนมากในครั้งเดียว</p>
      </div>

      {/* Step 1: Download Template */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 bg-cocoa-700 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">1</span>
          <h2 className="font-semibold text-gray-900">ดาวน์โหลด Template</h2>
        </div>
        <p className="text-sm text-gray-500 ml-8">
          ดาวน์โหลด Template แล้วกรอกข้อมูลตามรูปแบบที่กำหนด
          ไฟล์มี 2 Sheet — <strong>ยอดขาย</strong> (รายเมนู) และ <strong>ต้นทุน Platform</strong>
        </p>
        <div className="ml-8">
          <button
            onClick={() => downloadTemplate(platList)}
            disabled={refLoading}
            className="btn-primary flex items-center gap-2"
          >
            {refLoading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            ดาวน์โหลด Template (.xlsx)
          </button>
        </div>
        {refLoading && (
          <p className="text-xs text-gray-400 ml-8 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> กำลังโหลดรายการ Platform...
          </p>
        )}
      </div>

      {/* Step 2: Upload File */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 bg-cocoa-700 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">2</span>
          <h2 className="font-semibold text-gray-900">อัปโหลดไฟล์</h2>
        </div>

        {!fileName ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง รองรับไฟล์ .xlsx และ .xls"
            className="ml-8 border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-cocoa-400 hover:bg-cocoa-50 focus:outline-none focus:ring-2 focus:ring-cocoa-400 focus:border-cocoa-400 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
          >
            <FileUp size={40} className="text-gray-300" />
            <div className="text-center">
              <p className="font-medium text-gray-700">คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง</p>
              <p className="text-sm text-gray-400 mt-1">รองรับไฟล์ .xlsx และ .xls</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onFileInputChange}
              tabIndex={-1}
            />
          </div>
        ) : (
          <div className="ml-8 flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={24} className="text-green-600 shrink-0" />
              <div>
                <p className="font-medium text-gray-800 text-sm">{fileName}</p>
                {parsed && (
                  <p className="text-xs text-gray-500">
                    {parsed.salesData.length} แถวยอดขาย · {parsed.costsData.length} แถวต้นทุน
                  </p>
                )}
              </div>
            </div>
            <button onClick={reset} className="btn-ghost flex items-center gap-1 text-sm text-gray-500">
              <RotateCcw size={14} /> เปลี่ยนไฟล์
            </button>
          </div>
        )}
      </div>

      {/* Step 3: Preview + Validation */}
      {validated && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 bg-cocoa-700 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <h2 className="font-semibold text-gray-900">ตรวจสอบข้อมูล</h2>
            {hasErrors
              ? <span className="ml-auto text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> มีข้อผิดพลาด {validated.errors.length} รายการ</span>
              : <span className="ml-auto text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={13} /> ข้อมูลถูกต้องทั้งหมด</span>
            }
          </div>

          {/* Validation errors */}
          {hasErrors && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1 max-h-36 overflow-y-auto">
              {validated.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-700">
                  <span className="font-medium">[{e.sheet} แถว {e.row}]</span> {e.messages.join(', ')}
                </p>
              ))}
            </div>
          )}

          {/* Sales preview table */}
          {validated.rows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                ยอดขาย — {validSalesCount} / {validated.rows.length} แถว ผ่านการตรวจสอบ
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">สถานะ</th>
                      <th className="px-3 py-2 text-left">วันที่</th>
                      <th className="px-3 py-2 text-left">Platform</th>
                      <th className="px-3 py-2 text-left">เมนู</th>
                      <th className="px-3 py-2 text-right">จำนวน</th>
                      <th className="px-3 py-2 text-right">ราคา</th>
                      <th className="px-3 py-2 text-right">ต้นทุน GP</th>
                      <th className="px-3 py-2 text-center">Campaign</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {validated.rows.map((row, i) => (
                      <tr key={i} className={row._errors.length ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-2">
                          {row._errors.length
                            ? <XCircle size={14} className="text-red-500" />
                            : <CheckCircle2 size={14} className="text-green-500" />}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.date}</td>
                        <td className="px-3 py-2 text-gray-700">{row.platform}</td>
                        <td className="px-3 py-2 text-gray-700">{row.menuName}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{row.qty}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{row.unitPrice ? formatBaht(row.unitPrice) : '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{row.unitGpCost ? formatBaht(row.unitGpCost) : '—'}</td>
                        <td className="px-3 py-2 text-center">{row.isCampaign ? 'Y' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Costs preview table */}
          {validated.costRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                ต้นทุน Platform — {validCostCount} / {validated.costRows.length} แถว ผ่านการตรวจสอบ
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">สถานะ</th>
                      <th className="px-3 py-2 text-left">วันที่</th>
                      <th className="px-3 py-2 text-left">Platform</th>
                      <th className="px-3 py-2 text-right">ส่วนลดเมนู</th>
                      <th className="px-3 py-2 text-right">Campaign</th>
                      <th className="px-3 py-2 text-right">Marketing</th>
                      <th className="px-3 py-2 text-right">ส่วนลด Delivery</th>
                      <th className="px-3 py-2 text-right">โฆษณา</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {validated.costRows.map((row, i) => (
                      <tr key={i} className={row._errors.length ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-2">
                          {row._errors.length
                            ? <XCircle size={14} className="text-red-500" />
                            : <CheckCircle2 size={14} className="text-green-500" />}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.date}</td>
                        <td className="px-3 py-2 text-gray-700">{row.platform}</td>
                        <td className="px-3 py-2 text-right">{formatBaht(row.menu_discount)}</td>
                        <td className="px-3 py-2 text-right">{formatBaht(row.campaign)}</td>
                        <td className="px-3 py-2 text-right">{formatBaht(row.marketing_fee)}</td>
                        <td className="px-3 py-2 text-right">{formatBaht(row.delivery_discount)}</td>
                        <td className="px-3 py-2 text-right">{formatBaht(row.advertisement)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import button */}
          {!importResult && (validSalesCount > 0 || validCostCount > 0) && (
            <div className="pt-2">
              {hasErrors && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-xs text-amber-700">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <span>แถวที่มีข้อผิดพลาดจะถูกข้ามไป ระบบจะนำเข้าเฉพาะแถวที่ถูกต้อง ({validSalesCount} ยอดขาย, {validCostCount} ต้นทุน)</span>
                </div>
              )}
              <button
                onClick={handleImport}
                disabled={importing}
                className="btn-primary flex items-center gap-2"
              >
                {importing
                  ? <><Loader2 size={16} className="animate-spin" /> กำลังนำเข้า...</>
                  : <><Upload size={16} /> นำเข้าข้อมูล ({validSalesCount + validCostCount} รายการ)</>
                }
              </button>
            </div>
          )}
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 bg-cocoa-700 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">4</span>
            <h2 className="font-semibold text-gray-900">ผลการนำเข้า</h2>
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 size={20} />
              <span className="font-semibold">{importResult.success} สำเร็จ</span>
            </div>
            {importResult.failed > 0 && (
              <div className="flex items-center gap-2 text-red-600">
                <XCircle size={20} />
                <span className="font-semibold">{importResult.failed} ล้มเหลว</span>
              </div>
            )}
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {importResult.details.map((d, i) => (
              <div key={i} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg ${d.status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {d.status === 'ok' ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <XCircle size={13} className="shrink-0 mt-0.5" />}
                <span>{d.label}{d.message ? ` — ${d.message}` : ''}</span>
              </div>
            ))}
          </div>
          <button onClick={reset} className="btn-secondary flex items-center gap-2">
            <RotateCcw size={15} /> นำเข้าไฟล์ใหม่
          </button>
        </div>
      )}
    </div>
  )
}
