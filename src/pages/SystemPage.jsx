/**
 * SystemPage.jsx — Cocoa House System Architecture
 * แสดง structure ของระบบทั้งหมด: pages, data flow, supabase tables
 */

const COCOA_BROWN = '#7c4a1e'

// ─── Data ────────────────────────────────────────────────────────────────────

const APPS = [
  {
    id: 'cocoa-house',
    label: 'Cocoa House',
    sublabel: 'cocoa-house.vercel.app',
    color: '#7c4a1e',
    bg: '#fdf6f0',
    border: '#e8c9a8',
    pages: [
      {
        path: '/',
        label: 'Dashboard',
        labelTh: 'แดชบอร์ด',
        desc: 'สรุปยอดขาย กำไร และ KPI รายวัน',
        mode: 'read',
        tables: ['orders', 'order_items', 'platform_costs', 'menus', 'menu_costs', 'cost_settings'],
      },
      {
        path: '/sales',
        label: 'SalesEntryPage',
        labelTh: 'กรอกยอดขาย',
        desc: 'บันทึกยอดขาย Platform Cost และดู GP',
        mode: 'readwrite',
        tables: ['platform_costs', 'menus', 'menu_costs', 'cost_settings', 'settings'],
      },
      {
        path: '/history',
        label: 'SalesHistoryPage',
        labelTh: 'ประวัติยอดขาย',
        desc: 'ดูประวัติยอดขายรายวัน ย้อนหลัง',
        mode: 'read',
        tables: ['orders', 'order_items', 'platform_costs', 'menus'],
      },
      {
        path: '/cashflow',
        label: 'CashFlowPage',
        labelTh: 'รายรับรายจ่าย',
        desc: 'บันทึกรายรับ-รายจ่ายเงินสด',
        mode: 'readwrite',
        tables: ['cashbook_entries', 'transfer_status'],
      },
      {
        path: '/menu',
        label: 'MenuManagementPage',
        labelTh: 'จัดการเมนู',
        desc: 'เพิ่ม/แก้ไข/เรียงลำดับเมนู ราคาแต่ละ Platform',
        mode: 'readwrite',
        tables: ['menus', 'menu_prices'],
      },
      {
        path: '/cost',
        label: 'MenuCostPage',
        labelTh: 'ต้นทุนเมนู',
        desc: 'คำนวณต้นทุนวัตถุดิบ แรงงาน และ GP ต่อเมนู',
        mode: 'readwrite',
        tables: ['menus', 'menu_costs', 'cost_settings'],
      },
      {
        path: '/reports',
        label: 'ReportsPage',
        labelTh: 'รายงาน & Export',
        desc: 'Export ข้อมูลยอดขายและรายการสินค้า',
        mode: 'read',
        tables: ['orders', 'order_items', 'platform_costs', 'menus'],
      },
      {
        path: '/settings',
        label: 'SettingsPage',
        labelTh: 'ตั้งค่า',
        desc: 'ตั้งค่า Platform Fee % และค่าแรง (admin)',
        mode: 'readwrite',
        tables: ['settings'],
        adminOnly: true,
      },
      {
        path: '/label-settings',
        label: 'LabelSettingsPage',
        labelTh: 'ตั้งค่าฉลาก',
        desc: 'ออกแบบฉลาก WYSIWYG + เชื่อมต่อ print-server (admin)',
        mode: 'readwrite',
        tables: ['settings'],
        adminOnly: true,
        external: 'print-server (TCP)',
      },
      {
        path: '/users',
        label: 'UserManagementPage',
        labelTh: 'การจัดการผู้ใช้งาน',
        desc: 'เพิ่ม/แก้ไขผู้ใช้ กำหนด role (admin)',
        mode: 'readwrite',
        tables: ['auth.users', 'user_roles'],
        adminOnly: true,
      },
      {
        path: '/import',
        label: 'ImportPage',
        labelTh: 'นำเข้าข้อมูล',
        desc: 'Import ออเดอร์จากไฟล์ CSV/Excel (admin)',
        mode: 'write',
        tables: ['orders', 'order_items', 'platform_costs', 'menus', 'menu_costs', 'cost_settings'],
        adminOnly: true,
      },
    ],
  },
  {
    id: 'cocoa-pos',
    label: 'Cocoa POS',
    sublabel: 'cocoa-pos.vercel.app',
    color: '#1a6b3c',
    bg: '#f0fdf4',
    border: '#a7d9be',
    pages: [
      {
        path: '?tab=pos',
        label: 'POSPage',
        labelTh: 'หน้า POS',
        desc: 'รับออเดอร์ เลือกเมนู + ตัวเลือก พิมพ์ฉลาก',
        mode: 'readwrite',
        tables: ['orders', 'order_items', 'platform_costs', 'menus', 'menu_prices'],
        external: 'print-server (ESC/POS)',
      },
      {
        path: '?tab=orders',
        label: 'OrderManagePage',
        labelTh: 'จัดการออเดอร์',
        desc: 'ดูออเดอร์ประจำวัน อัพเดต status พร้อมส่ง',
        mode: 'readwrite',
        tables: ['orders', 'order_items'],
      },
    ],
  },
]

const TABLES = [
  { name: 'orders',            desc: 'ออเดอร์หลัก',               cols: 'id, date, platform, status, notes, discount' },
  { name: 'order_items',       desc: 'รายการสินค้าในออเดอร์',     cols: 'order_id, menu_id, quantity, unit_price, unit_gp_cost, is_campaign, item_options' },
  { name: 'platform_costs',    desc: 'ต้นทุน Platform รายวัน',    cols: 'date, platform, net_sales, platform_fee, menu_discount, campaign, marketing_fee, delivery_discount, advertisement' },
  { name: 'menus',             desc: 'เมนูทั้งหมด',               cols: 'id, name, category, image_url, is_active, sort_order' },
  { name: 'menu_prices',       desc: 'ราคาเมนูแต่ละ Platform',   cols: 'menu_id, platform, price' },
  { name: 'menu_costs',        desc: 'ต้นทุนวัตถุดิบต่อเมนู',    cols: 'menu_id, main_ingredient, milk_*, packaging_type, custom_costs, effective_from/to' },
  { name: 'cost_settings',     desc: 'ค่า shared cost (packaging, labor%)', cols: 'key, value, effective_from' },
  { name: 'settings',          desc: 'ตั้งค่า global (platform fee%, store name)', cols: 'key, value' },
  { name: 'cashbook_entries',  desc: 'รายการเงินสด รายรับ/รายจ่าย', cols: 'id, date, type, amount, note, category' },
  { name: 'transfer_status',   desc: 'สถานะโอนเงิน',              cols: 'date, platform, status' },
  { name: 'auth.users',        desc: 'ผู้ใช้งานระบบ (Supabase Auth)', cols: 'id, email' },
  { name: 'user_roles',        desc: 'Role ของผู้ใช้งาน',         cols: 'user_id, role (admin/staff)' },
]

const CALC_RULES = [
  { step: 'Layer 1', label: 'Sales (ยอดขายรวม)', formula: 'Σ (quantity × unit_price)', color: '#dbeafe' },
  { step: 'Layer 2', label: 'Gross Sales (ยอดสุทธิ)', formula: 'Sales − Menu Discount', color: '#dcfce7' },
  { step: 'Layer 3', label: 'Gross Profit (กำไรขั้นต้น)', formula: 'Gross Sales − GP Cost*', color: '#fef9c3', note: '*GP Cost คำนวณบน Gross Sales (หลัง discount)' },
  { step: 'Layer 4', label: 'Net Profit (กำไรสุทธิ)', formula: 'Gross Profit − (Campaign + Marketing + Delivery + Advert)', color: '#fce7f3' },
  { step: 'Layer 5', label: 'Net Profit %', formula: 'Net Profit ÷ Gross Sales × 100', color: '#ede9fe' },
]

// ─── Components ──────────────────────────────────────────────────────────────

function ModeTag({ mode }) {
  const map = {
    read:      { label: 'อ่าน',       bg: '#dbeafe', color: '#1d4ed8' },
    write:     { label: 'เขียน',      bg: '#dcfce7', color: '#15803d' },
    readwrite: { label: 'อ่าน/เขียน', bg: '#fef9c3', color: '#92400e' },
  }
  const s = map[mode] ?? map.read
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function AdminTag() {
  return (
    <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>
      admin
    </span>
  )
}

function TableTag({ name }) {
  return (
    <span style={{
      display: 'inline-block', background: '#f1f5f9', color: '#475569',
      fontSize: 10, padding: '2px 7px', borderRadius: 6, border: '1px solid #e2e8f0',
      fontFamily: 'monospace', marginBottom: 3, marginRight: 3,
    }}>
      {name}
    </span>
  )
}

function PageCard({ page, appColor }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
      borderLeft: `3px solid ${appColor}`,
    }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{page.labelTh}</span>
        <ModeTag mode={page.mode} />
        {page.adminOnly && <AdminTag />}
      </div>

      {/* path + component */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <code style={{ fontSize: 11, color: '#7c3aed', background: '#f5f3ff', padding: '2px 6px', borderRadius: 4 }}>{page.path}</code>
        <span style={{ fontSize: 11, color: '#6b7280' }}>→ {page.label}</span>
      </div>

      {/* desc */}
      <p style={{ fontSize: 12, color: '#4b5563', margin: 0, lineHeight: 1.5 }}>{page.desc}</p>

      {/* tables */}
      <div style={{ marginTop: 2 }}>
        {page.tables.map(t => <TableTag key={t} name={t} />)}
        {page.external && (
          <span style={{
            display: 'inline-block', background: '#fff7ed', color: '#c2410c',
            fontSize: 10, padding: '2px 7px', borderRadius: 6, border: '1px solid #fed7aa',
            fontFamily: 'monospace', marginBottom: 3, marginRight: 3,
          }}>
            🔌 {page.external}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SystemPage() {
  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto', fontFamily: 'inherit' }}>

      {/* Title */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: COCOA_BROWN, margin: 0 }}>
          System Architecture
        </h1>
        <p style={{ color: '#6b7280', marginTop: 4, fontSize: 13 }}>
          โครงสร้างระบบ Cocoa House — แอพ, หน้า, ตาราง Supabase และกฎการคำนวณ
        </p>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        {[
          { label: 'อ่านอย่างเดียว', bg: '#dbeafe', color: '#1d4ed8' },
          { label: 'เขียนอย่างเดียว', bg: '#dcfce7', color: '#15803d' },
          { label: 'อ่าน/เขียน', bg: '#fef9c3', color: '#92400e' },
          { label: 'admin only', bg: '#fee2e2', color: '#b91c1c' },
        ].map(s => (
          <span key={s.label} style={{ background: s.bg, color: s.color, fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 600, border: `1px solid ${s.color}30` }}>
            {s.label}
          </span>
        ))}
      </div>

      {/* Apps */}
      {APPS.map(app => (
        <section key={app.id} style={{ marginBottom: 32 }}>
          {/* App header */}
          <div style={{
            background: app.bg, border: `1px solid ${app.border}`, borderRadius: 12,
            padding: '12px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div>
              <span style={{ fontWeight: 800, fontSize: 16, color: app.color }}>{app.label}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>—</span>
              <a href={`https://${app.sublabel}`} target="_blank" rel="noreferrer"
                style={{ marginLeft: 6, fontSize: 12, color: app.color, textDecoration: 'none', opacity: 0.8 }}>
                {app.sublabel}
              </a>
            </div>
            <span style={{
              marginLeft: 'auto', fontSize: 11, color: app.color, background: app.bg,
              border: `1px solid ${app.border}`, borderRadius: 99, padding: '2px 10px', fontWeight: 600,
            }}>
              {app.pages.length} หน้า
            </span>
          </div>

          {/* Page grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {app.pages.map(page => (
              <PageCard key={page.path} page={page} appColor={app.color} />
            ))}
          </div>
        </section>
      ))}

      {/* GP Calculation Rules */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 14, borderBottom: '2px solid #e5e7eb', paddingBottom: 8 }}>
          🧮 กฎการคำนวณ GP (5-Layer Profit)
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {CALC_RULES.map((r, i) => (
            <div key={r.step} style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
              {/* connector */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: r.color, border: '2px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#374151' }}>
                  {i + 1}
                </div>
                {i < CALC_RULES.length - 1 && (
                  <div style={{ width: 2, height: 20, background: '#e5e7eb', margin: '2px 0' }} />
                )}
              </div>
              {/* content */}
              <div style={{ background: r.color, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', marginLeft: 10, marginBottom: i < CALC_RULES.length - 1 ? 4 : 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{r.label}</span>
                  <code style={{ fontSize: 12, color: '#374151', background: 'rgba(255,255,255,0.6)', padding: '1px 6px', borderRadius: 4 }}>{r.formula}</code>
                </div>
                {r.note && (
                  <p style={{ fontSize: 11, color: '#92400e', margin: '4px 0 0', fontStyle: 'italic' }}>⚠️ {r.note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>
          ใช้ใน: <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 3 }}>src/utils/calculations.js → calcPlatformProfit()</code>
          {' · '}เรียกจาก DashboardPage, SalesHistoryPage, SalesEntryPage
        </p>
      </section>

      {/* Supabase Tables */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 14, borderBottom: '2px solid #e5e7eb', paddingBottom: 8 }}>
          🗄️ Supabase Tables
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {TABLES.map(t => (
            <div key={t.name} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <code style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>{t.name}</code>
              </div>
              <p style={{ fontSize: 12, color: '#4b5563', margin: '0 0 6px' }}>{t.desc}</p>
              <p style={{ fontSize: 10, color: '#94a3b8', margin: 0, fontFamily: 'monospace', lineHeight: 1.6 }}>{t.cols}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Data Flow Note */}
      <section style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 10 }}>🔄 Data Flow หลัก</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { from: 'Cocoa POS (POSPage)', arrow: '→', to: 'orders + order_items', note: 'บันทึกออเดอร์ใหม่' },
            { from: 'Cocoa POS (POSPage)', arrow: '→', to: 'platform_costs.menu_discount', note: 'sync discount รวมต่อ platform ต่อวัน (auto)' },
            { from: 'SalesEntryPage', arrow: '→', to: 'platform_costs', note: 'กรอก net_sales, platform_fee, campaign, advert ฯลฯ' },
            { from: 'SettingsPage', arrow: '→', to: 'settings', note: 'ตั้ง platform_fee_pct, labor_pct ที่ใช้คำนวณ GP' },
            { from: 'Dashboard / History', arrow: '←', to: 'orders + order_items + platform_costs', note: 'อ่านข้อมูลเพื่อคำนวณ 5-Layer Profit' },
            { from: 'LabelSettingsPage', arrow: '→', to: 'print-server (localhost TCP)', note: 'ส่ง ESC/POS command พิมพ์ฉลาก' },
          ].map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: 11, padding: '3px 9px', borderRadius: 6, fontWeight: 600 }}>{f.from}</span>
              <span style={{ color: '#6b7280', fontSize: 14, fontWeight: 700 }}>{f.arrow}</span>
              <code style={{ background: '#f1f5f9', color: '#374151', fontSize: 11, padding: '3px 8px', borderRadius: 6 }}>{f.to}</code>
              <span style={{ fontSize: 11, color: '#6b7280' }}>— {f.note}</span>
            </div>
          ))}
        </div>
      </section>

      <p style={{ fontSize: 11, color: '#d1d5db', textAlign: 'right' }}>
        Cocoa House · System Architecture · อัปเดต {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}
