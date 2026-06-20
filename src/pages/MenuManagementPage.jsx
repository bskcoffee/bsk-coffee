import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, updateMenuPrice } from '../lib/supabase'
import { formatBaht } from '../utils/calculations'
import { Plus, Pencil, Eye, EyeOff, X, History, GripVertical, Calculator, Ban, ImagePlus, Loader2 } from 'lucide-react'

const PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']
const CATEGORIES = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot', 'Bun', 'Refill', 'Addon']

const PLAT_BADGE = {
  GRAB:        'bg-green-100 text-green-800',
  LINE:        'bg-green-600 text-white',
  SHOPEE:      'bg-orange-100 text-orange-800',
  'The metro': 'bg-blue-100 text-blue-800',
  TU:          'bg-purple-100 text-purple-800',
}

function MenuModal({ menu, onClose, onSave }) {
  const [form, setForm] = useState({
    name: menu?.name ?? '',
    category: menu?.category ?? 'Cocoa',
    image_url: menu?.image_url ?? '',
    prices: {
      GRAB: 0, LINE: 0, SHOPEE: 0, 'The metro': 0, TU: 0,
      ...(menu?.prices ?? {}),
    }
  })
  const [saving,       setSaving]       = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [pendingUrl,   setPendingUrl]   = useState(null)   // object URL before upload
  const [pendingFile,  setPendingFile]  = useState(null)   // raw File
  const [pendingDims,  setPendingDims]  = useState(null)   // { w, h }
  const [cropPos,      setCropPos]      = useState({ x: 50, y: 50 }) // 0-100%

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

  // Drag to reposition crop area
  const moveCrop = (clientX, clientY) => {
    if (!dragging.current || !pendingDims || !previewRef.current) return
    const { w, h } = pendingDims
    const rect = previewRef.current.getBoundingClientRect()
    const scale = rect.width / Math.min(w, h)
    const extraW = Math.max(0, w * scale - rect.width)
    const extraH = Math.max(0, h * scale - rect.height)
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

  // Crop at current cropPos and upload
  const uploadCropped = async () => {
    if (!pendingFile || !pendingUrl || !pendingDims) return
    setUploadingImg(true)
    try {
      const SIZE = 500
      const { w, h } = pendingDims
      const s = Math.min(w, h)
      const sx = (cropPos.x / 100) * (w - s)
      const sy = (cropPos.y / 100) * (h - s)
      const blob = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = SIZE; canvas.height = SIZE
          canvas.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE)
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)

    try {
      if (menu?.id) {
        // Update — ไม่แตะ gp_cost (จัดการผ่านหน้าต้นทุนเมนู)
        await supabase.from('menus').update({
          name:      form.name,
          category:  form.category,
          image_url: form.image_url || null,
        }).eq('id', menu.id)

        // Update prices (close old, open new)
        for (const plat of PLATFORMS) {
          const oldPrice = menu.prices?.[plat] ?? 0
          const newPrice = form.prices[plat] ?? 0
          if (oldPrice !== newPrice) {
            await updateMenuPrice(menu.id, plat, newPrice)
          }
        }
      } else {
        // Create new
        const { data: newMenu } = await supabase
          .from('menus')
          .insert({ name: form.name, category: form.category, image_url: form.image_url || null })
          .select()
          .single()

        if (newMenu) {
          for (const plat of PLATFORMS) {
            await supabase.from('menu_prices').insert({
              menu_id:        newMenu.id,
              platform:       plat,
              price:          form.prices[plat] ?? 0,
              effective_from: new Date().toISOString().slice(0, 10),
            })
          }
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
              <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-gray-200">
                <img src={form.image_url} alt="preview" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setForm(f => ({ ...f, image_url: '' }))}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1">
                  <X size={14} />
                </button>
                <button type="button" onClick={() => imgInputRef.current?.click()}
                  className="absolute bottom-2 right-2 bg-black/50 hover:bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
                  <ImagePlus size={13} /> เปลี่ยนรูป
                </button>
              </div>

            ) : pendingUrl ? (
              /* 2. เลือกรูปแล้ว — ลากเพื่อปรับตำแหน่ง crop */
              <div className="space-y-2">
                <p className="text-xs text-cocoa-600 font-medium text-center">ลากรูปเพื่อเลือกส่วนที่ต้องการ</p>
                <div
                  ref={previewRef}
                  className="relative w-full aspect-square rounded-xl overflow-hidden border-2 border-cocoa-400 cursor-grab active:cursor-grabbing select-none"
                  onMouseDown={onDragMouseDown}
                  onMouseMove={onDragMouseMove}
                  onTouchStart={onDragTouchStart}
                  onTouchMove={onDragTouchMove}
                >
                  <img
                    src={pendingUrl} alt="crop preview" draggable={false}
                    className="w-full h-full pointer-events-none"
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
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* หมายเหตุ GP Cost */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
            <Calculator size={16} className="shrink-0 mt-0.5" />
            <p>GP Cost คำนวณอัตโนมัติจากหน้า <strong>ต้นทุนเมนู</strong> ไม่ต้องกรอกที่นี่</p>
          </div>

          <div>
            <p className="label">ราคาขายแยกต่อ Platform (฿)</p>
            <div className="grid grid-cols-2 gap-3">
              {PLATFORMS.map(plat => (
                <div key={plat}>
                  <label className="text-xs font-medium text-gray-500">{plat}</label>
                  <input
                    type="number"
                    className="input text-right"
                    min="0"
                    step="0.01"
                    value={form.prices[plat]}
                    onChange={e => setForm(f => ({
                      ...f,
                      prices: { ...f.prices, [plat]: parseFloat(e.target.value) || 0 }
                    }))}
                  />
                </div>
              ))}
            </div>
            {menu && (
              <p className="text-xs text-amber-600 mt-1">⚠ การเปลี่ยนราคาจะมีผลกับยอดขายวันนี้เป็นต้นไป ยอดเก่าไม่กระทบ</p>
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
                    <span className={`badge mr-2 ${PLAT_BADGE[h.platform]}`}>{h.platform}</span>
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
  const dragId = useRef(null)
  const dragOverId = useRef(null)

  const loadMenus = async () => {
    const { data } = await supabase
      .from('menus')
      .select('*, menu_prices(platform, price, effective_from, effective_to)')
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
  }, [])

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
    const prices = {}
    for (const p of menu.menu_prices ?? []) {
      if (!p.effective_to) prices[p.platform] = p.price
    }
    return prices
  }

  const filtered = menus.filter(m => {
    if (!showInactive && !m.is_active) return false
    if (filterCategory !== 'all' && m.category !== filterCategory) return false
    return true
  })

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(m => m.category === cat)
    if (items.length > 0) acc[cat] = items
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
        {CATEGORIES.map(cat => {
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
                const prices  = getMenuPrices(menu)
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
                    {/* รูปภาพเมนู */}
                    {menu.image_url ? (
                      <img src={menu.image_url} alt={menu.name}
                        className="w-14 h-14 rounded-xl object-cover shrink-0 border border-gray-100" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-2xl">🍫</div>
                    )}
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
                        {PLATFORMS.map(p => (
                          <span key={p} className={`badge ${PLAT_BADGE[p]}`}>
                            {p} {formatBaht(prices[p] ?? 0)}
                          </span>
                        ))}
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
                        onClick={() => setEditMenu({ ...menu, prices })}
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
          onClose={() => { setShowAdd(false); setEditMenu(null) }}
          onSave={loadMenus}
        />
      )}
      {historyMenu && (
        <PriceHistoryModal menu={historyMenu} onClose={() => setHistoryMenu(null)} />
      )}
    </div>
  )
}
