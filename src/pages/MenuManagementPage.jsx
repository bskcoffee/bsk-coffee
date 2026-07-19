import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, updateMenuPrice, getSetting } from '../lib/supabase'
import { formatBaht } from '../utils/calculations'
import { Plus, Pencil, Eye, EyeOff, X, History, GripVertical, Calculator, Ban, ImagePlus, Loader2, Tags, Trash2, ChevronUp, ChevronDown, ListChecks } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'

// Fallback เมื่อยังไม่มีการตั้งค่า platform ใน Supabase (ต้องตรงกับ LEGACY_PLATFORMS ใน SettingsPage.jsx)
const DEFAULT_PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU', 'Other']
// ค่าเริ่มต้นเมื่อยังไม่มี settings.menu_categories — ตรงกับ list เดิมที่เคย hardcode ไว้
const DEFAULT_CATEGORIES = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot', 'Bun']
const CATEGORIES_KEY = 'menu_categories'
const NEW_CATEGORY_VALUE = '__new_category__'

const PLAT_BADGE = {
  GRAB:        'bg-green-100 text-green-800',
  LINE:        'bg-green-600 text-white',
  SHOPEE:      'bg-orange-100 text-orange-800',
  'The metro': 'bg-blue-100 text-blue-800',
  TU:          'bg-purple-100 text-purple-800',
}
const DEFAULT_BADGE = 'bg-gray-100 text-gray-700'

// โหลดรายชื่อ platform ปัจจุบันจาก Supabase (key เดียวกับที่หน้าตั้งค่าใช้บันทึก)
async function loadPlatformNames() {
  try {
    const raw = await getSetting('platform_config')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(p => p.name).filter(Boolean)
      }
    }
  } catch { /* fall through to default */ }
  return DEFAULT_PLATFORMS
}

// โหลดรายชื่อหมวดหมู่สินค้าปัจจุบันจาก Supabase
async function loadCategoryNames() {
  try {
    const raw = await getSetting(CATEGORIES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(Boolean)
      }
    }
  } catch { /* fall through to default */ }
  return DEFAULT_CATEGORIES
}

async function saveCategoryNames(list) {
  return supabase
    .from('settings')
    .upsert({ key: CATEGORIES_KEY, value: JSON.stringify(list) }, { onConflict: 'key' })
}

function MenuModal({ menu, platforms, categories, onAddCategory, onClose, onSave }) {
  const [form, setForm] = useState({
    name: menu?.name ?? '',
    category: menu?.category ?? categories[0] ?? 'Cocoa',
    image_url: menu?.image_url ?? '',
    prices: {
      ...Object.fromEntries(platforms.map(p => [p, 0])),
      ...(menu?.prices ?? {}),
    },
    originalPrices: {
      ...Object.fromEntries(platforms.map(p => [p, 0])),
      ...(menu?.originalPrices ?? {}),
    },
  })
  const [saving,       setSaving]       = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [pendingUrl,   setPendingUrl]   = useState(null)   // object URL before upload
  const [pendingFile,  setPendingFile]  = useState(null)   // raw File
  const [pendingDims,  setPendingDims]  = useState(null)   // { w, h }
  const [cropPos,      setCropPos]      = useState({ x: 50, y: 50 }) // 0-100%

  // --- เพิ่มหมวดหมู่ใหม่แบบด่วนจากในฟอร์มนี้ ---
  const [addingCat,   setAddingCat]   = useState(false)
  const [newCatName,  setNewCatName]  = useState('')
  const [catError,    setCatError]    = useState('')
  const [savingCat,   setSavingCat]   = useState(false)

  const imgInputRef = useRef(null)
  const previewRef  = useRef(null)
  const dragging    = useRef(false)
  const lastXY      = useRef({ x: 0, y: 0 })

  // Stop drag on mouse/touch up anywhere
  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('mouseup', up)
    window.addEventListener('touchend', up)
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up) }
  }, [])

  // File select → show pending crop preview (no upload yet)
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (pendingUrl) URL.revokeObjectURL(pendingUrl)
    const url = URL.createObjectURL(file)
    setPendingFile(file); setPendingUrl(url); setCropPos({ x: 50, y: 50 })
    const img = new Image()
    img.onload = () => setPendingDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = url
  }

  const cancelPending = () => {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl)
    setPendingFile(null); setPendingUrl(null); setPendingDims(null)
    setCropPos({ x: 50, y: 50 })
    if (imgInputRef.current) imgInputRef.current.value = ''
  }

  // Drag to reposition crop area — ใช้ object-fit:cover math จาก container ขนาดจริง
  const moveCrop = (clientX, clientY) => {
    if (!dragging.current || !pendingDims || !previewRef.current) return
    const { w, h } = pendingDims
    const rect = previewRef.current.getBoundingClientRect()
    const CW = rect.width, CH = rect.height
    // object-fit:cover: scale ตาม dimension ที่ overflow
    let extraW, extraH
    if (w / h >= CW / CH) {
      const scale = CH / h
      extraW = w * scale - CW
      extraH = 0
    } else {
      const scale = CW / w
      extraW = 0
      extraH = h * scale - CH
    }
    const dx = clientX - lastXY.current.x
    const dy = clientY - lastXY.current.y
    lastXY.current = { x: clientX, y: clientY }
    setCropPos(prev => ({
      x: extraW > 0 ? Math.max(0, Math.min(100, prev.x - (dx / extraW) * 100)) : 50,
      y: extraH > 0 ? Math.max(0, Math.min(100, prev.y - (dy / extraH) * 100)) : 50,
    }))
  }

  const onDragMouseDown  = (e) => { dragging.current = true; lastXY.current = { x: e.clientX, y: e.clientY }; e.preventDefault() }
  const onDragMouseMove  = (e) => moveCrop(e.clientX, e.clientY)
  const onDragTouchStart = (e) => { dragging.current = true; const t = e.touches[0]; lastXY.current = { x: t.clientX, y: t.clientY } }
  const onDragTouchMove  = (e) => { const t = e.touches[0]; moveCrop(t.clientX, t.clientY) }

  // Crop at current cropPos — อัตราส่วน 10:7 (เดียวกับ POS card)
  const uploadCropped = async () => {
    if (!pendingFile || !pendingUrl || !pendingDims) return
    setUploadingImg(true)
    try {
      const CANVAS_W = 700, CANVAS_H = 490  // 10:7 ratio output
      const RATIO = 10 / 7
      const { w, h } = pendingDims
      let cropW, cropH, sx, sy
      if (w / h >= RATIO) {
        cropH = h; cropW = h * RATIO
        sy = 0; sx = (cropPos.x / 100) * (w - cropW)
      } else {
        cropW = w; cropH = w / RATIO
        sx = 0; sy = (cropPos.y / 100) * (h - cropH)
      }
      const blob = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = CANVAS_W; canvas.height = CANVAS_H
          canvas.getContext('2d').drawImage(img, sx, sy, cropW, cropH, 0, 0, CANVAS_W, CANVAS_H)
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('crop failed')), 'image/jpeg', 0.85)
        }
        img.onerror = reject
        img.src = pendingUrl
      })
      const path = `menus/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      const { error: upErr } = await supabase.storage.from('menu-images').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('menu-images').getPublicUrl(path)
      setForm(f => ({ ...f, image_url: data.publicUrl }))
      cancelPending()
    } catch (err) { alert('อัปโหลดรูปไม่สำเร็จ: ' + err.message) }
    setUploadingImg(false)
  }

  const handleCategoryChange = (value) => {
    if (value === NEW_CATEGORY_VALUE) {
      setAddingCat(true)
      setCatError('')
      return
    }
    setForm(f => ({ ...f, category: value }))
  }

  const handleAddCategory = async () => {
    const trimmed = newCatName.trim()
    if (!trimmed) return
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      setCatError('มีหมวดหมู่นี้อยู่แล้ว')
      return
    }
    setSavingCat(true)
    try {
      await onAddCategory(trimmed)
      setForm(f => ({ ...f, category: trimmed }))
      setAddingCat(false)
      setNewCatName('')
      setCatError('')
    } catch (err) {
      setCatError('เพิ่มหมวดหมู่ไม่สำเร็จ: ' + err.message)
    }
    setSavingCat(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)

    try {
      if (menu?.id) {
        // Update — ไม่แตะ gp_cost (จัดการผ่านหน้าต้นทุนเมนู)
        const { error: updateErr } = await supabase.from('menus').update({
          name:      form.name,
          category:  form.category,
          image_url: form.image_url || null,
        }).eq('id', menu.id)
        if (updateErr) throw updateErr

        // Update prices (close old, open new) + original_price
        for (const plat of platforms) {
          const oldPrice    = menu.prices?.[plat]         ?? 0
          const newPrice    = form.prices[plat]           ?? 0
          const origPrice   = form.originalPrices[plat]  ?? 0
          if (oldPrice !== newPrice) {
            const { error: priceErr } = await updateMenuPrice(menu.id, plat, newPrice)
            if (priceErr) throw priceErr
          }
          // อัพเดท original_price บน row ปัจจุบัน (effective_to IS NULL)
          const { error: origErr } = await supabase.from('menu_prices')
            .update({ original_price: origPrice })
            .eq('menu_id', menu.id)
            .eq('platform', plat)
            .is('effective_to', null)
          if (origErr) throw origErr
        }
      } else {
        // Create new
        const { data: newMenu, error: insertErr } = await supabase
          .from('menus')
          .insert({ name: form.name, category: form.category, image_url: form.image_url || null })
          .select()
          .single()
        if (insertErr) throw insertErr
        if (!newMenu) throw new Error('บันทึกเมนูไม่สำเร็จ — ไม่ได้รับข้อมูลกลับจากระบบ')

        for (const plat of platforms) {
          const { error: priceInsertErr } = await supabase.from('menu_prices').insert({
            menu_id:        newMenu.id,
            platform:       plat,
            price:          form.prices[plat]          ?? 0,
            original_price: form.originalPrices[plat]  ?? form.prices[plat] ?? 0,
            effective_from: new Date().toISOString().slice(0, 10),
          })
          if (priceInsertErr) throw priceInsertErr
        }
      }

      onSave()
      onClose()
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-lg">{menu ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่'}</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* ── รูปภาพเมนู ── */}
          <div>
            <label className="label">รูปภาพเมนู</label>
            <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

            {/* 1. รูปที่อัปโหลดแล้ว */}
            {form.image_url && !pendingUrl ? (
              <div className="relative w-full rounded-xl overflow-hidden border border-gray-200" style={{ paddingBottom: '70%', position: 'relative' }}>
                <img src={form.image_url} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
                <button type="button" onClick={() => setForm(f => ({ ...f, image_url: '' }))}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 z-10">
                  <X size={14} />
                </button>
                <button type="button" onClick={() => imgInputRef.current?.click()}
                  className="absolute bottom-2 right-2 bg-black/50 hover:bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 z-10">
                  <ImagePlus size={13} /> เปลี่ยนรูป
                </button>
              </div>

            ) : pendingUrl ? (
              /* 2. เลือกรูปแล้ว — ลากเพื่อปรับตำแหน่ง crop */
              <div className="space-y-2">
                <p className="text-xs text-cocoa-600 font-medium text-center">ลากรูปเพื่อเลือกส่วนที่ต้องการ</p>
                <div
                  ref={previewRef}
                  className="relative w-full rounded-xl overflow-hidden border-2 border-cocoa-400 cursor-grab active:cursor-grabbing select-none"
                  style={{ paddingBottom: '70%' }}
                  onMouseDown={onDragMouseDown}
                  onMouseMove={onDragMouseMove}
                  onTouchStart={onDragTouchStart}
                  onTouchMove={onDragTouchMove}
                >
                  <img
                    src={pendingUrl} alt="crop preview" draggable={false}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ objectFit: 'cover', objectPosition: `${cropPos.x}% ${cropPos.y}%`, userSelect: 'none' }}
                  />
                  {/* Grid overlay */}
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundImage: 'linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)',
                    backgroundSize: '33.33% 33.33%',
                  }} />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={cancelPending}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 font-medium">
                    ยกเลิก
                  </button>
                  <button type="button" onClick={uploadCropped} disabled={uploadingImg}
                    className="flex-1 py-2.5 rounded-xl bg-cocoa-700 text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-60">
                    {uploadingImg
                      ? <><Loader2 size={14} className="animate-spin" /> กำลังอัปโหลด...</>
                      : <><ImagePlus size={14} /> ยืนยันอัปโหลด</>
                    }
                  </button>
                </div>
              </div>

            ) : (
              /* 3. ยังไม่มีรูป */
              <button type="button" onClick={() => imgInputRef.current?.click()}
                className="w-full h-32 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-cocoa-300 hover:text-cocoa-500 transition-colors">
                <ImagePlus size={24} />
                <span className="text-sm">คลิกเพื่อเลือกรูป</span>
              </button>
            )}
          </div>

          <div>
            <label className="label">ชื่อเมนู</label>
            <input
              className="input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="label">หมวดหมู่</label>
            <select
              className="input"
              value={form.category}
              onChange={e => handleCategoryChange(e.target.value)}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value={NEW_CATEGORY_VALUE}>+ เพิ่มหมวดหมู่ใหม่...</option>
            </select>

            {addingCat && (
              <div className="mt-2">
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className="input flex-1"
                    placeholder="ชื่อหมวดหมู่ใหม่"
                    value={newCatName}
                    onChange={e => { setNewCatName(e.target.value); setCatError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory() } }}
                  />
                  <button type="button" onClick={handleAddCategory} disabled={savingCat}
                    className="btn-primary px-3 text-sm shrink-0">
                    {savingCat ? '...' : 'เพิ่ม'}
                  </button>
                  <button type="button" onClick={() => { setAddingCat(false); setNewCatName(''); setCatError('') }}
                    className="btn-secondary px-3 text-sm shrink-0">
                    ยกเลิก
                  </button>
                </div>
                {catError && <p className="text-xs text-red-500 mt-1">{catError}</p>}
              </div>
            )}
          </div>

          {/* หมายเหตุ GP Cost */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
            <Calculator size={16} className="shrink-0 mt-0.5" />
            <p>GP Cost คำนวณอัตโนมัติจากหน้า <strong>ต้นทุนเมนู</strong> ไม่ต้องกรอกที่นี่</p>
          </div>

          <div>
            <p className="label">ราคาขายแยกต่อ Platform (฿)</p>
            {/* header row */}
            <div className="grid grid-cols-3 gap-2 mb-1 px-1">
              <span className="text-xs font-medium text-gray-400">Platform</span>
              <span className="text-xs font-medium text-gray-400 text-right">ราคาปกติ</span>
              <span className="text-xs font-medium text-gray-400 text-right">ราคาขายตอนนี้</span>
            </div>
            <div className="flex flex-col gap-2">
              {platforms.map(plat => {
                const orig   = form.originalPrices[plat] ?? 0
                const cur    = form.prices[plat] ?? 0
                const disc   = orig > 0 && cur < orig
                  ? Math.round((orig - cur) / orig * 100) : 0
                return (
                  <div key={plat} className="grid grid-cols-3 gap-2 items-center">
                    <div className="flex items-center gap-1.5">
                      <span className={`badge text-xs ${PLAT_BADGE[plat] || DEFAULT_BADGE}`}>{plat}</span>
                      {disc > 0 && (
                        <span className="text-[10px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded-full">
                          -{disc}%
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      className="input text-right text-sm"
                      min="0"
                      step="1"
                      placeholder="ราคาปกติ"
                      value={form.originalPrices[plat] || ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        originalPrices: { ...f.originalPrices, [plat]: parseFloat(e.target.value) || 0 }
                      }))}
                    />
                    <input
                      type="number"
                      className={`input text-right text-sm ${disc > 0 ? 'border-red-300 bg-red-50' : ''}`}
                      min="0"
                      step="1"
                      placeholder="ราคาขาย"
                      value={form.prices[plat] || ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        prices: { ...f.prices, [plat]: parseFloat(e.target.value) || 0 }
                      }))}
                    />
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              💡 ราคาปกติ = rack rate ที่ไม่เปลี่ยน | ราคาขายตอนนี้ = ปรับเมื่อมีแคมเปญ
            </p>
            {menu && (
              <p className="text-xs text-amber-600 mt-1">⚠ การเปลี่ยนราคาขายจะมีผลวันนี้เป็นต้นไป ยอดเก่าไม่กระทบ</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PriceHistoryModal({ menu, onClose }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('menu_prices')
      .select('*')
      .eq('menu_id', menu.id)
      .order('effective_from', { ascending: false })
      .then(({ data }) => {
        setHistory(data ?? [])
        setLoading(false)
      })
  }, [menu.id])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-lg">ประวัติราคา — {menu.name}</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="p-4">
          {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด...</p> : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div>
                    <span className={`badge mr-2 ${PLAT_BADGE[h.platform] || DEFAULT_BADGE}`}>{h.platform}</span>
                    <span className="font-medium">{formatBaht(h.price)}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {h.effective_from} → {h.effective_to ?? 'ปัจจุบัน'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// จัดการหมวดหมู่สินค้าเต็มรูปแบบ: เพิ่ม / เปลี่ยนชื่อ / ลบ / เรียงลำดับ
// หมวดหมู่ที่ POS ผูก logic พิเศษไว้ (Bun/Refill/Addon) แก้ชื่อ/ลบจากตรงนี้ไม่ได้
function CategoryManagerModal({ categories, menuCountByCategory, onClose, onSaved }) {
  const [rows, setRows]           = useState(categories.map(c => ({ original: c, name: c })))
  const [newName, setNewName]     = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [deleteIdx, setDeleteIdx] = useState(null) // index รอ confirm ลบ

  const countFor = (row) => menuCountByCategory[row.original ?? row.name] ?? 0

  const addRow = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (rows.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('มีหมวดหมู่นี้อยู่แล้ว')
      return
    }
    setRows(prev => [...prev, { original: null, name: trimmed }])
    setNewName('')
    setError('')
  }

  const renameRow = (idx, value) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, name: value } : r))
    setError('')
  }

  const requestDelete = (idx) => {
    const row = rows[idx]
    const count = countFor(row)
    if (count > 0) {
      setError(`ลบไม่ได้ — ยังมีเมนู ${count} รายการใช้หมวดหมู่ "${row.name}" อยู่ ย้ายเมนูเหล่านั้นไปหมวดหมู่อื่นก่อน`)
      return
    }
    setDeleteIdx(idx)
  }

  const confirmDelete = () => {
    setRows(prev => prev.filter((_, i) => i !== deleteIdx))
    setDeleteIdx(null)
  }

  const moveRow = (idx, direction) => {
    const target = idx + direction
    if (target < 0 || target >= rows.length) return
    setRows(prev => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const handleSave = async () => {
    const names = rows.map(r => r.name.trim())
    if (names.some(n => !n)) { setError('ชื่อหมวดหมู่ห้ามว่าง'); return }
    const lower = names.map(n => n.toLowerCase())
    if (new Set(lower).size !== lower.length) { setError('มีชื่อหมวดหมู่ซ้ำกัน'); return }

    setSaving(true)
    setError('')
    try {
      // ย้ายเมนูเก่าตามชื่อหมวดหมู่ที่เปลี่ยน (category เก็บเป็น string ตรงๆ บน menus table)
      for (const row of rows) {
        const trimmedName = row.name.trim()
        if (row.original && row.original !== trimmedName) {
          const { error: renameErr } = await supabase
            .from('menus')
            .update({ category: trimmedName })
            .eq('category', row.original)
          if (renameErr) throw renameErr
        }
      }
      const finalList = names
      const { error: saveErr } = await saveCategoryNames(finalList)
      if (saveErr) throw saveErr
      onSaved(finalList)
      onClose()
    } catch (err) {
      setError('บันทึกไม่สำเร็จ: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-lg flex items-center gap-2"><Tags size={18} /> จัดการหมวดหมู่</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500">
            เพิ่ม เปลี่ยนชื่อ ลบ หรือเรียงลำดับหมวดหมู่สินค้า
          </p>

          <div className="space-y-1.5">
            {rows.map((row, idx) => {
              const count    = countFor(row)
              return (
                <div key={idx} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1.5">
                  <div className="flex flex-col -my-1 shrink-0">
                    <button type="button" onClick={() => moveRow(idx, -1)} disabled={idx === 0}
                      aria-label={`ย้าย ${row.name} ขึ้น`}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none">
                      <ChevronUp size={13} />
                    </button>
                    <button type="button" onClick={() => moveRow(idx, 1)} disabled={idx === rows.length - 1}
                      aria-label={`ย้าย ${row.name} ลง`}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none">
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <input
                    className="input flex-1 text-sm"
                    value={row.name}
                    onChange={e => renameRow(idx, e.target.value)}
                  />
                  {count > 0 && (
                    <span className="text-[11px] text-gray-400 shrink-0">{count} เมนู</span>
                  )}
                  <button type="button" onClick={() => requestDelete(idx)}
                    title="ลบหมวดหมู่"
                    className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              placeholder="ชื่อหมวดหมู่ใหม่"
              value={newName}
              onChange={e => { setNewName(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }}
            />
            <button type="button" onClick={addRow} className="btn-secondary px-3 text-sm shrink-0 flex items-center gap-1">
              <Plus size={14} /> เพิ่ม
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deleteIdx !== null}
        title={`ลบหมวดหมู่ "${deleteIdx !== null ? rows[deleteIdx]?.name : ''}"?`}
        message="ยังไม่มีเมนูใดใช้หมวดหมู่นี้ ลบได้ทันที"
        confirmLabel="ลบ"
        danger
        icon={Trash2}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteIdx(null)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// กลุ่มตัวเลือกเสริม (menu_option_groups + menu_option_choices)
// แอดมินสร้างกลุ่มตัวเลือกเอง (เช่น "เพิ่มอีกถุงไว้ดื่มพรุ่งนี้ ลดเพิ่ม 20%")
// แล้วผูกกับหมวดหมู่เมนู — เมนูในหมวดหมู่นั้นจะเห็นกลุ่มนี้โผล่อัตโนมัติในหน้า POS
// ─────────────────────────────────────────────────────────────────

function OptionGroupEditor({ group, categories, menus = [], onClose, onSaved }) {
  const [name,          setName]          = useState(group?.name ?? '')
  const [selectionType, setSelectionType] = useState(group?.selection_type ?? 'multi')
  const [maxSelect,     setMaxSelect]     = useState(group?.max_select ?? '')
  const [required,      setRequired]      = useState(group?.required ?? false)
  const [selectedCats,  setSelectedCats]  = useState(Array.isArray(group?.categories) ? group.categories : [])
  const [selectedMenuIds, setSelectedMenuIds] = useState(group?.menu_ids ?? [])
  const [choices,       setChoices]       = useState(
    group?.menu_option_choices?.length
      ? group.menu_option_choices.map(c => ({ id: c.id, label: c.label, price: c.price }))
      : [{ label: '', price: 0 }]
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const selectableCats = categories

  // เมนูจัดกลุ่มตามหมวดหมู่ ให้เลือกทีละเมนูได้ง่าย (ผูกเฉพาะเมนูนั้นๆ แทนที่จะผูกทั้งหมวด)
  const menusByCategory = useMemo(() => {
    const acc = {}
    for (const m of menus) {
      const cat = m.category || 'อื่นๆ'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(m)
    }
    return acc
  }, [menus])

  const toggleCat = (cat) => {
    setSelectedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  const toggleMenu = (menuId) => {
    setSelectedMenuIds(prev => prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId])
  }

  const addChoice    = () => setChoices(prev => [...prev, { label: '', price: 0 }])
  const removeChoice = (idx) => setChoices(prev => prev.filter((_, i) => i !== idx))
  const updateChoice = (idx, field, value) => setChoices(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  const moveChoice = (idx, dir) => {
    const target = idx + dir
    if (target < 0 || target >= choices.length) return
    setChoices(prev => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) { setError('กรุณาใส่ชื่อกลุ่มตัวเลือก'); return }
    const validChoices = choices.map(c => ({ ...c, label: c.label.trim() })).filter(c => c.label)
    if (validChoices.length === 0) { setError('กรุณาเพิ่มตัวเลือกอย่างน้อย 1 รายการ'); return }
    if (selectedCats.length === 0 && selectedMenuIds.length === 0) {
      setError('กรุณาเลือกอย่างน้อย 1 หมวดหมู่ หรือ 1 เมนู'); return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        name:           trimmedName,
        selection_type: selectionType,
        max_select:     selectionType === 'multi' ? (parseInt(maxSelect) || null) : 1,
        required,
        categories:     selectedCats,
        menu_ids:       selectedMenuIds,
      }
      let groupId = group?.id
      if (groupId) {
        const { error: upErr } = await supabase.from('menu_option_groups').update(payload).eq('id', groupId)
        if (upErr) throw upErr
      } else {
        const { data: newGroup, error: insErr } = await supabase.from('menu_option_groups')
          .insert({ ...payload, sort_order: 0 }).select().single()
        if (insErr) throw insErr
        groupId = newGroup.id
      }

      // sync ตัวเลือก: ลบอันที่ถูกเอาออก, อัพเดท/เพิ่มที่เหลือ
      const existingIds = (group?.menu_option_choices ?? []).map(c => c.id)
      const keptIds      = validChoices.filter(c => c.id).map(c => c.id)
      const toDelete     = existingIds.filter(id => !keptIds.includes(id))
      if (toDelete.length > 0) {
        await supabase.from('menu_option_choices').delete().in('id', toDelete)
      }
      for (let i = 0; i < validChoices.length; i++) {
        const c = validChoices[i]
        if (c.id) {
          await supabase.from('menu_option_choices').update({
            label: c.label, price: parseFloat(c.price) || 0, sort_order: i,
          }).eq('id', c.id)
        } else {
          await supabase.from('menu_option_choices').insert({
            group_id: groupId, label: c.label, price: parseFloat(c.price) || 0, sort_order: i,
          })
        }
      }

      onSaved()
      onClose()
    } catch (err) {
      setError('บันทึกไม่สำเร็จ: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-lg">{group ? 'แก้ไขกลุ่มตัวเลือก' : 'สร้างกลุ่มตัวเลือกใหม่'}</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">ชื่อกลุ่มตัวเลือก</label>
            <input
              className="input"
              placeholder='เช่น "เพิ่มอีกถุงไว้ดื่มพรุ่งนี้ ลดเพิ่ม 20%"'
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label">รูปแบบการเลือก</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelectionType('single')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 ${selectionType === 'single' ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700' : 'border-gray-200 text-gray-500'}`}>
                เลือกได้ 1 (radio)
              </button>
              <button type="button" onClick={() => setSelectionType('multi')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 ${selectionType === 'multi' ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700' : 'border-gray-200 text-gray-500'}`}>
                เลือกได้หลายอัน (checkbox)
              </button>
            </div>
          </div>

          {selectionType === 'multi' && (
            <div>
              <label className="label">เลือกได้สูงสุดกี่อัน</label>
              <input
                type="number" min="1" className="input" placeholder="ไม่จำกัด"
                value={maxSelect}
                onChange={e => setMaxSelect(e.target.value)}
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} className="w-4 h-4" />
            บังคับให้ลูกค้าต้องเลือก
          </label>

          <div>
            <label className="label">ผูกกับหมวดหมู่เมนู (ทางเลือก)</label>
            <div className="flex flex-wrap gap-2">
              {selectableCats.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCat(cat)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 ${selectedCats.includes(cat) ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700' : 'border-gray-200 text-gray-500'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">ทุกเมนูในหมวดหมู่ที่เลือกจะเห็นกลุ่มตัวเลือกนี้ในหน้า POS — ใช้เมื่ออยากผูกทั้งหมวดหมู่</p>
          </div>

          <div>
            <label className="label">หรือผูกกับเมนูเฉพาะรายการ</label>
            <div className="border border-gray-200 rounded-xl max-h-48 overflow-y-auto divide-y divide-gray-100">
              {Object.keys(menusByCategory).length === 0 ? (
                <p className="text-xs text-gray-400 p-3">ยังไม่มีเมนู</p>
              ) : (
                Object.entries(menusByCategory).map(([cat, catMenus]) => (
                  <div key={cat} className="p-2">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider px-1 mb-1">{cat}</p>
                    <div className="space-y-0.5">
                      {catMenus.map(m => (
                        <label key={m.id} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={selectedMenuIds.includes(m.id)}
                            onChange={() => toggleMenu(m.id)}
                          />
                          <span className="text-gray-700">{m.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">เฉพาะเมนูที่ติ๊กเท่านั้นจะเห็นกลุ่มตัวเลือกนี้ — ใช้เมื่อไม่อยากให้ทั้งหมวดหมู่เห็นเหมือนกันหมด</p>
          </div>

          <div>
            <label className="label">ตัวเลือก + ราคา</label>
            <div className="space-y-2">
              {choices.map((c, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <div className="flex flex-col -my-1 shrink-0">
                    <button type="button" onClick={() => moveChoice(idx, -1)} disabled={idx === 0}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:pointer-events-none"><ChevronUp size={13} /></button>
                    <button type="button" onClick={() => moveChoice(idx, 1)} disabled={idx === choices.length - 1}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:pointer-events-none"><ChevronDown size={13} /></button>
                  </div>
                  <input
                    className="input flex-1 text-sm"
                    placeholder="ชื่อตัวเลือก เช่น Classic No.1 (แนะนำ)"
                    value={c.label}
                    onChange={e => updateChoice(idx, 'label', e.target.value)}
                  />
                  <input
                    type="number" min="0" className="input w-24 text-sm text-right"
                    placeholder="ราคา"
                    value={c.price}
                    onChange={e => updateChoice(idx, 'price', e.target.value)}
                  />
                  <button type="button" onClick={() => removeChoice(idx)}
                    className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 shrink-0"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addChoice} className="btn-secondary mt-2 text-sm flex items-center gap-1">
              <Plus size={14} /> เพิ่มตัวเลือก
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function OptionGroupManagerModal({ categories, menus = [], onClose, onSaved }) {
  const [groups,      setGroups]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [editGroup,   setEditGroup]   = useState(null)
  const [showAdd,     setShowAdd]     = useState(false)
  const [deleteGroup, setDeleteGroup] = useState(null)
  const dragGroupId = useRef(null)
  const dragOverGroupId = useRef(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('menu_option_groups')
      .select('*, menu_option_choices(*)')
      .order('sort_order', { ascending: true })
    setGroups((data ?? []).map(g => ({
      ...g,
      menu_option_choices: (g.menu_option_choices ?? []).sort((a, b) => a.sort_order - b.sort_order),
    })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSaved = () => { load(); onSaved() }

  const confirmDelete = async () => {
    if (!deleteGroup) return
    await supabase.from('menu_option_groups').delete().eq('id', deleteGroup.id)
    setDeleteGroup(null)
    handleSaved()
  }

  const toggleActive = async (group) => {
    await supabase.from('menu_option_groups').update({ is_active: !group.is_active }).eq('id', group.id)
    load()
  }

  // เรียงลำดับกลุ่มตัวเลือกเสริม — ลำดับนี้จะไปกำหนดลำดับที่โผล่ในหน้า POS ด้วย (ดู sort_order ใน POSPage.jsx)
  const persistGroupOrder = async (reordered) => {
    setGroups(reordered)
    await Promise.all(
      reordered.map((g, i) =>
        supabase.from('menu_option_groups').update({ sort_order: i }).eq('id', g.id)
      )
    )
  }

  const moveGroup = (id, delta) => {
    const idx = groups.findIndex(g => g.id === id)
    const swapIdx = idx + delta
    if (idx === -1 || swapIdx < 0 || swapIdx >= groups.length) return
    const reordered = [...groups]
    ;[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]]
    persistGroupOrder(reordered)
  }

  const handleGroupDragStart = (id) => { dragGroupId.current = id }
  const handleGroupDragOver = (e, id) => { e.preventDefault(); dragOverGroupId.current = id }
  const handleGroupDrop = () => {
    const from = dragGroupId.current
    const to   = dragOverGroupId.current
    if (!from || !to || from === to) return
    const reordered = [...groups]
    const fromIdx = reordered.findIndex(g => g.id === from)
    const toIdx   = reordered.findIndex(g => g.id === to)
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    persistGroupOrder(reordered)
    dragGroupId.current = null
    dragOverGroupId.current = null
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-lg flex items-center gap-2"><ListChecks size={18} /> จัดการตัวเลือกเสริม</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500">
            สร้างกลุ่มตัวเลือกเสริม (เช่น แพ็คคละแบรนด์) แล้วผูกกับหมวดหมู่เมนู — เมนูในหมวดหมู่นั้นจะโผล่กลุ่มนี้ในหน้า POS อัตโนมัติ
          </p>

          {loading ? (
            <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
          ) : groups.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">ยังไม่มีกลุ่มตัวเลือกเสริม</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">⠿ ลากเพื่อเรียงลำดับ หรือกดปุ่มลูกศร — ลำดับนี้จะใช้แสดงในหน้า POS ด้วย</p>
              {groups.map((g, i) => (
                <div
                  key={g.id}
                  draggable
                  onDragStart={() => handleGroupDragStart(g.id)}
                  onDragOver={(e) => handleGroupDragOver(e, g.id)}
                  onDrop={handleGroupDrop}
                  className={`card flex items-start gap-3 cursor-grab active:cursor-grabbing ${!g.is_active ? 'opacity-50' : ''}`}
                >
                  <GripVertical size={16} className="mt-1 text-gray-300 shrink-0" aria-hidden="true" />
                  {/* Keyboard/touch-friendly reorder alternative to drag-and-drop */}
                  <div className="flex flex-col shrink-0 mt-0.5">
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => moveGroup(g.id, -1)}
                      disabled={i === 0}
                      aria-label={`ย้าย ${g.name} ขึ้น`}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => moveGroup(g.id, 1)}
                      disabled={i === groups.length - 1}
                      aria-label={`ย้าย ${g.name} ลง`}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{g.name}</p>
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      <span className="badge bg-gray-100 text-gray-600">
                        {g.selection_type === 'single' ? 'เลือกได้ 1' : `เลือกได้สูงสุด ${g.max_select ?? 'ไม่จำกัด'}`}
                      </span>
                      {g.required && <span className="badge bg-amber-100 text-amber-700">บังคับเลือก</span>}
                      {(Array.isArray(g.categories) ? g.categories : []).map(c => <span key={c} className="badge bg-cocoa-50 text-cocoa-700">{c}</span>)}
                      {(g.menu_ids ?? []).length > 0 && (
                        <span className="badge bg-blue-50 text-blue-700">
                          {(g.menu_ids ?? []).length} เมนูเฉพาะ
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{(g.menu_option_choices ?? []).length} ตัวเลือก</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => toggleActive(g)}
                      className={`p-2 rounded-lg ${g.is_active ? 'text-gray-400 hover:bg-gray-100 hover:text-red-500' : 'text-green-500 hover:bg-green-50'}`}
                      title={g.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}>
                      {g.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button onClick={() => setEditGroup(g)} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-cocoa-700" title="แก้ไข">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => setDeleteGroup(g)} className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="ลบ">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => setShowAdd(true)} className="btn-primary w-full flex items-center justify-center gap-2">
            <Plus size={16} /> สร้างกลุ่มตัวเลือกใหม่
          </button>
        </div>
      </div>

      {(showAdd || editGroup) && (
        <OptionGroupEditor
          group={editGroup}
          categories={categories}
          menus={menus}
          onClose={() => { setShowAdd(false); setEditGroup(null) }}
          onSaved={handleSaved}
        />
      )}

      <ConfirmModal
        open={!!deleteGroup}
        title={`ลบกลุ่มตัวเลือก "${deleteGroup?.name}"?`}
        message="ตัวเลือกทั้งหมดในกลุ่มนี้จะถูกลบไปด้วย"
        confirmLabel="ลบ"
        danger
        icon={Trash2}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteGroup(null)}
      />
    </div>
  )
}

export default function MenuManagementPage() {
  const navigate = useNavigate()
  const [menus, setMenus] = useState([])
  const [menuCosts, setMenuCosts] = useState({}) // { menuId: { materialCost } }
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [editMenu, setEditMenu] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [historyMenu, setHistoryMenu] = useState(null)
  const [platforms, setPlatforms] = useState(DEFAULT_PLATFORMS)
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [showCatManager, setShowCatManager] = useState(false)
  const [showGroupManager, setShowGroupManager] = useState(false)
  const dragId = useRef(null)
  const dragOverId = useRef(null)

  const loadMenus = async () => {
    const { data } = await supabase
      .from('menus')
      .select('*, menu_prices(platform, price, original_price, effective_from, effective_to)')
      .order('sort_order', { ascending: true })
      .order('name')
    if (data) setMenus(data)
    setLoading(false)
  }

  // โหลด menu_costs เพื่อแสดง material cost ที่คำนวณแล้ว
  const loadMenuCosts = async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('menu_costs')
      .select('menu_id, main_ingredient, milk_condensed, milk_mixed, milk_fresh')
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gt.${today}`)
      .order('effective_from', { ascending: false })

    // Deduplicate: เอา row ล่าสุดต่อ menu_id
    const latest = {}
    for (const row of data ?? []) {
      if (!latest[row.menu_id]) {
        const mat = (Number(row.main_ingredient) || 0)
                  + (Number(row.milk_condensed)  || 0)
                  + (Number(row.milk_mixed)       || 0)
                  + (Number(row.milk_fresh)       || 0)
        latest[row.menu_id] = { materialCost: mat, hasData: true }
      }
    }
    setMenuCosts(latest)
  }

  useEffect(() => {
    loadMenus()
    loadMenuCosts()
    loadPlatformNames().then(setPlatforms)
    loadCategoryNames().then(setCategories)
  }, [])

  const handleAddCategory = async (name) => {
    const next = [...categories, name]
    setCategories(next)
    const { error } = await saveCategoryNames(next)
    if (error) throw error
  }

  const handleDragStart = (id) => { dragId.current = id }

  const handleDragOver = (e, id) => {
    e.preventDefault()
    dragOverId.current = id
  }

  const handleDrop = async () => {
    const from = dragId.current
    const to = dragOverId.current
    if (!from || !to || from === to) return

    const reordered = [...menus]
    const fromIdx = reordered.findIndex(m => m.id === from)
    const toIdx   = reordered.findIndex(m => m.id === to)
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)

    const updated = reordered.map((m, i) => ({ ...m, sort_order: i + 1 }))
    setMenus(updated)

    await Promise.all(
      updated.map(m =>
        supabase.from('menus').update({ sort_order: m.sort_order }).eq('id', m.id)
      )
    )
    dragId.current = null
    dragOverId.current = null
  }

  const toggleSoldOut = async (menu) => {
    await supabase.from('menus').update({ is_sold_out: !menu.is_sold_out }).eq('id', menu.id)
    loadMenus()
  }

  const resetAllSoldOut = async () => {
    const soldOutCount = menus.filter(m => m.is_sold_out).length
    if (soldOutCount === 0) return
    if (!window.confirm(`เปิดขายทั้งหมด ${soldOutCount} รายการที่หมดสต็อก?`)) return
    await supabase.from('menus').update({ is_sold_out: false }).eq('is_sold_out', true)
    loadMenus()
  }

  const toggleActive = async (menu) => {
    const { count } = await supabase
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .eq('menu_id', menu.id)

    if (count > 0 && menu.is_active) {
      await supabase.from('menus').update({ is_active: false }).eq('id', menu.id)
    } else {
      await supabase.from('menus').update({ is_active: !menu.is_active }).eq('id', menu.id)
    }
    loadMenus()
  }

  const getMenuPrices = (menu) => {
    const prices = {}, originalPrices = {}
    for (const p of menu.menu_prices ?? []) {
      if (!p.effective_to) {
        prices[p.platform]         = p.price
        originalPrices[p.platform] = p.original_price ?? p.price
      }
    }
    return { prices, originalPrices }
  }

  const filtered = menus.filter(m => {
    if (!showInactive && !m.is_active) return false
    if (filterCategory !== 'all' && m.category !== filterCategory) return false
    return true
  })

  const grouped = categories.reduce((acc, cat) => {
    const items = filtered.filter(m => m.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})

  const menuCountByCategory = menus.reduce((acc, m) => {
    acc[m.category] = (acc[m.category] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-gray-900">จัดการเมนู</h1>
        <div className="flex items-center gap-2">
          {menus.some(m => m.is_sold_out) && (
            <button
              onClick={resetAllSoldOut}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium hover:bg-orange-100 transition-colors"
            >
              <Ban size={14} /> เปิดขายทั้งหมด ({menus.filter(m => m.is_sold_out).length})
            </button>
          )}
          <button onClick={() => setShowCatManager(true)} className="btn-secondary flex items-center gap-2">
            <Tags size={16} /> จัดการหมวดหมู่
          </button>
          <button onClick={() => setShowGroupManager(true)} className="btn-secondary flex items-center gap-2">
            <ListChecks size={16} /> จัดการตัวเลือกเสริม
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> เพิ่มเมนู
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => setFilterCategory('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium ${filterCategory === 'all' ? 'bg-cocoa-700 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
        >
          ทั้งหมด ({menus.filter(m => showInactive || m.is_active).length})
        </button>
        {categories.map(cat => {
          const count = menus.filter(m => m.category === cat && (showInactive || m.is_active)).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium ${filterCategory === cat ? 'bg-cocoa-700 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
            >
              {cat} ({count})
            </button>
          )
        })}
        <button
          onClick={() => setShowInactive(!showInactive)}
          className={`ml-auto px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1 ${showInactive ? 'bg-gray-700 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
        >
          {showInactive ? <Eye size={14} /> : <EyeOff size={14} />}
          {showInactive ? 'ซ่อนเมนูซ่อน' : 'แสดงเมนูซ่อน'}
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-3">⠿ ลากที่ไอคอนซ้ายเพื่อเรียงลำดับเมนู</p>

      {/* Menu list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="mb-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{cat} ({items.length})</h2>
            <div className="space-y-2">
              {items.map(menu => {
                const { prices, originalPrices } = getMenuPrices(menu)
                const cost    = menuCosts[menu.id]
                return (
                  <div
                    key={menu.id}
                    draggable
                    onDragStart={() => handleDragStart(menu.id)}
                    onDragOver={(e) => handleDragOver(e, menu.id)}
                    onDrop={handleDrop}
                    className={`card flex items-start gap-3 cursor-grab active:cursor-grabbing transition-opacity ${!menu.is_active ? 'opacity-50' : ''}`}
                  >
                    <div className="pt-1 text-gray-300 hover:text-gray-500 shrink-0">
                      <GripVertical size={18} />
                    </div>
                    {/* รูปภาพเมนู — 10:7 เดียวกับ POS card */}
                    <div className="shrink-0 w-20 rounded-xl overflow-hidden border border-gray-100" style={{ aspectRatio: '10/7' }}>
                      {menu.image_url ? (
                        <img src={menu.image_url} alt={menu.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-50 flex items-center justify-center text-2xl">🍫</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900 text-sm">{menu.name}</p>
                        {menu.is_sold_out && (
                          <span className="badge bg-orange-100 text-orange-700 border border-orange-200">🚫 หมด</span>
                        )}
                        {!menu.is_active && <span className="badge bg-gray-100 text-gray-500">ซ่อน</span>}
                      </div>

                      {/* Material Cost จาก MenuCostPage */}
                      <div className="flex items-center gap-2 mt-0.5 mb-1.5">
                        {cost?.hasData ? (
                          <span className="text-xs text-gray-500">
                            Material Cost: <span className="font-medium text-gray-700">{formatBaht(cost.materialCost)}</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => navigate('/cost')}
                            className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                          >
                            <Calculator size={11} /> ยังไม่มีข้อมูลต้นทุน — คลิกเพื่อกรอก
                          </button>
                        )}
                      </div>

                      <div className="flex gap-1.5 flex-wrap">
                        {platforms.map(p => {
                          const orig    = originalPrices[p] ?? 0
                          const cur     = prices[p] ?? 0
                          const discPct = orig > 0 && cur < orig
                            ? Math.round((orig - cur) / orig * 100) : 0
                          return (
                            <span key={p} className={`badge ${PLAT_BADGE[p] || DEFAULT_BADGE}`}>
                              {p} {formatBaht(cur)}
                              {discPct > 0 && (
                                <span className="ml-1 text-[10px] bg-red-100 text-red-700 font-bold px-1 rounded">
                                  -{discPct}%
                                </span>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex gap-1 shrink-0">
                      {/* Sold-out toggle */}
                      <button
                        onClick={() => toggleSoldOut(menu)}
                        className={`p-2 rounded-lg transition-colors ${
                          menu.is_sold_out
                            ? 'text-orange-500 bg-orange-50 hover:bg-orange-100'
                            : 'text-gray-400 hover:bg-orange-50 hover:text-orange-500'
                        }`}
                        title={menu.is_sold_out ? 'เปิดขาย' : 'ตั้งเป็นหมด'}
                      >
                        <Ban size={16} />
                      </button>
                      <button
                        onClick={() => navigate('/cost')}
                        className="p-2 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                        title="จัดการต้นทุน"
                      >
                        <Calculator size={16} />
                      </button>
                      <button
                        onClick={() => setHistoryMenu(menu)}
                        className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="ประวัติราคา"
                      >
                        <History size={16} />
                      </button>
                      <button
                        onClick={() => setEditMenu({ ...menu, prices, originalPrices })}
                        className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-cocoa-700"
                        title="แก้ไข"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => toggleActive(menu)}
                        className={`p-2 rounded-lg ${menu.is_active ? 'text-gray-400 hover:bg-gray-100 hover:text-red-500' : 'text-green-500 hover:bg-green-50'}`}
                        title={menu.is_active ? 'ซ่อน' : 'แสดง'}
                      >
                        {menu.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {(showAdd || editMenu) && (
        <MenuModal
          menu={editMenu}
          platforms={platforms}
          categories={categories}
          onAddCategory={handleAddCategory}
          onClose={() => { setShowAdd(false); setEditMenu(null) }}
          onSave={loadMenus}
        />
      )}
      {historyMenu && (
        <PriceHistoryModal menu={historyMenu} onClose={() => setHistoryMenu(null)} />
      )}
      {showCatManager && (
        <CategoryManagerModal
          categories={categories}
          menuCountByCategory={menuCountByCategory}
          onClose={() => setShowCatManager(false)}
          onSaved={(list) => { setCategories(list); loadMenus() }}
        />
      )}
      {showGroupManager && (
        <OptionGroupManagerModal
          categories={categories}
          menus={menus}
          onClose={() => setShowGroupManager(false)}
          onSaved={() => {}}
        />
      )}
    </div>
  )
}
