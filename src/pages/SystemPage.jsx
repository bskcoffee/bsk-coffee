/**
 * SystemPage.jsx — BSK coffee&bakery System Architecture
 * แสดง structure ของระบบทั้งหมด: pages, data flow, supabase tables
 */

// ─── Data ────────────────────────────────────────────────────────────────────

// Per-app color theme — Tailwind class groups instead of inline hex,
// so this page shares the same design system as the rest of the app.
const APP_THEME = {
  blue: {
    text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200',
    borderL: 'border-l-blue-700', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700', badgeBorder: 'border-blue-200',
  },
  green: {
    text: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200',
    borderL: 'border-l-green-700', badgeBg: 'bg-green-50', badgeText: 'text-green-700', badgeBorder: 'border-green-200',
  },
}

const APPS = [
  {
    id: 'cocoa-house',
    label: 'BSK coffee&bakery',
    sublabel: 'bsk-coffee.vercel.app',
    theme: APP_THEME.blue,
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
        desc: 'ตั้งค่า Platform Fee % และค่าแรง (admin — ปรับสิทธิ์ได้ที่ admin_page_access)',
        mode: 'readwrite',
        tables: ['settings'],
        adminOnly: true,
      },
      {
        path: '/label-settings',
        label: 'LabelSettingsPage',
        labelTh: 'ตั้งค่าฉลาก',
        desc: 'ออกแบบฉลาก WYSIWYG + เชื่อมต่อ print-server (admin — ปรับสิทธิ์ได้ที่ admin_page_access)',
        mode: 'readwrite',
        tables: ['settings'],
        adminOnly: true,
        external: 'print-server (TCP)',
      },
      {
        path: '/users',
        label: 'UserManagementPage',
        labelTh: 'การจัดการผู้ใช้งาน',
        desc: 'เพิ่ม/แก้ไขผู้ใช้ กำหนด role และสิทธิ์เข้าถึงเมนูของ Staff/Admin (admin — ปรับสิทธิ์ได้ที่ admin_page_access)',
        mode: 'readwrite',
        tables: ['auth.users', 'profiles', 'settings'],
        adminOnly: true,
      },
      {
        path: '/import',
        label: 'ImportPage',
        labelTh: 'นำเข้าข้อมูล',
        desc: 'Import ออเดอร์จากไฟล์ CSV/Excel (super admin เสมอ, admin ถ้าได้รับสิทธิ์จาก admin_page_access)',
        mode: 'write',
        tables: ['orders', 'order_items', 'platform_costs', 'menus', 'menu_costs', 'cost_settings'],
        superAdminOnly: true,
      },
      {
        path: '/ai',
        label: 'AIPage',
        labelTh: 'AI Memory',
        desc: 'ดูคำแนะนำ AI ย้อนหลัง ผล outcome และ action ทำแล้ว/ข้ามไป (super admin เสมอ, admin ถ้าได้รับสิทธิ์จาก admin_page_access)',
        mode: 'readwrite',
        tables: ['ai_memory'],
        superAdminOnly: true,
      },
    ],
  },
  {
    id: 'cocoa-pos',
    label: 'BSK POS',
    sublabel: 'cocoa-pos.vercel.app',
    theme: APP_THEME.green,
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
  { name: 'settings',          desc: 'ตั้งค่า global (platform fee%, store name, staff_page_access, admin_page_access)', cols: 'key, value' },
  { name: 'cashbook_entries',  desc: 'รายการเงินสด รายรับ/รายจ่าย', cols: 'id, date, type, amount, note, category' },
  { name: 'transfer_status',   desc: 'สถานะโอนเงิน',              cols: 'date, platform, status' },
  { name: 'auth.users',        desc: 'ผู้ใช้งานระบบ (Supabase Auth)', cols: 'id, email' },
  { name: 'profiles',          desc: 'Role ของผู้ใช้งาน (3 ระดับ)', cols: 'id, email, role (super_admin/admin/staff), created_at' },
]

const CALC_RULES = [
  { step: 'Layer 1', label: 'Sales (ยอดขายรวม)', formula: 'Σ (quantity × unit_price)', bg: 'bg-blue-100' },
  { step: 'Layer 2', label: 'Gross Sales (ยอดสุทธิ)', formula: 'Sales − Menu Discount', bg: 'bg-green-100' },
  { step: 'Layer 3', label: 'Gross Profit (กำไรขั้นต้น)', formula: 'Gross Sales − GP Cost*', bg: 'bg-yellow-100', note: '*GP Cost คำนวณบน Gross Sales (หลัง discount)' },
  { step: 'Layer 4', label: 'Net Profit (กำไรสุทธิ)', formula: 'Gross Profit − (Campaign + Marketing + Delivery + Advert)', bg: 'bg-pink-100' },
  { step: 'Layer 5', label: 'Net Profit %', formula: 'Net Profit ÷ Gross Sales × 100', bg: 'bg-purple-100' },
]

const MODE_STYLE = {
  read:      'bg-blue-100 text-blue-700',
  write:     'bg-green-100 text-green-700',
  readwrite: 'bg-yellow-100 text-amber-800',
}
const MODE_LABEL = { read: 'อ่าน', write: 'เขียน', readwrite: 'อ่าน/เขียน' }

const DATA_FLOW = [
  { from: 'BSK POS (POSPage)', arrow: '→', to: 'orders + order_items', note: 'บันทึกออเดอร์ใหม่' },
  { from: 'BSK POS (POSPage)', arrow: '→', to: 'platform_costs.menu_discount', note: 'sync discount รวมต่อ platform ต่อวัน (auto)' },
  { from: 'SalesEntryPage', arrow: '→', to: 'platform_costs', note: 'กรอก net_sales, platform_fee, campaign, advert ฯลฯ' },
  { from: 'SettingsPage', arrow: '→', to: 'settings', note: 'ตั้ง platform_fee_pct, labor_pct ที่ใช้คำนวณ GP' },
  { from: 'Dashboard / History', arrow: '←', to: 'orders + order_items + platform_costs', note: 'อ่านข้อมูลเพื่อคำนวณ 5-Layer Profit' },
  { from: 'LabelSettingsPage', arrow: '→', to: 'print-server (localhost TCP)', note: 'ส่ง ESC/POS command พิมพ์ฉลาก' },
  { from: 'UserManagementPage', arrow: '→', to: 'settings.staff_page_access', note: 'Admin/Super Admin กำหนดหน้าที่ Staff เข้าถึงได้' },
  { from: 'UserManagementPage', arrow: '→', to: 'settings.admin_page_access', note: 'Super Admin เท่านั้น กำหนดหน้าพิเศษที่ Admin เข้าถึงได้' },
  { from: 'Sidebar / BottomNav / App.jsx', arrow: '←', to: 'settings.staff_page_access + admin_page_access', note: 'ซ่อน/แสดงเมนู และกันเส้นทางตามสิทธิ์ของ role' },
]

const LEGEND = [
  { label: 'อ่านอย่างเดียว', className: 'bg-blue-100 text-blue-700' },
  { label: 'เขียนอย่างเดียว', className: 'bg-green-100 text-green-700' },
  { label: 'อ่าน/เขียน', className: 'bg-yellow-100 text-amber-800' },
  { label: 'admin only', className: 'bg-red-100 text-red-700' },
  { label: 'super admin only', className: 'bg-purple-100 text-purple-700' },
]

// 3-tier role system (profiles.role) — enforced both client-side (route
// guards in App.jsx) and server-side (change_user_role RPC + RLS).
const ROLE_TIERS = [
  {
    role: 'super_admin', label: 'Super Admin', className: 'bg-purple-100 text-purple-700 border-purple-200',
    desc: 'เห็น/เข้าถึงทุกหน้า รวมถึงหน้าที่เสี่ยงต่อข้อมูลจริง (Import, AI Memory, System Architecture) และเป็นคนเดียวที่เลื่อน/ลด role Super Admin ให้คนอื่นได้',
  },
  {
    role: 'admin', label: 'Admin', className: 'bg-cocoa-100 text-cocoa-700 border-cocoa-200',
    desc: 'จัดการร้านประจำวันได้ครบ (ตั้งค่า, ตั้งค่าฉลาก, จัดการผู้ใช้, กำหนดสิทธิ์เมนูของ Staff) — เข้าหน้าพิเศษอื่น (Import/AI/System) ได้เฉพาะที่ Super Admin เปิดให้ทาง admin_page_access และเลื่อน role ใครเป็น Super Admin ไม่ได้',
  },
  {
    role: 'staff', label: 'Staff', className: 'bg-gray-100 text-gray-600 border-gray-200',
    desc: 'เห็นเฉพาะหน้างานประจำวันที่ Admin/Super Admin เปิดให้ (ตั้งค่าที่ settings.staff_page_access) — ค่าเริ่มต้นเห็นทั้ง 7 หน้า',
  },
]

// ─── Components ──────────────────────────────────────────────────────────────

function ModeTag({ mode }) {
  return (
    <span className={`badge ${MODE_STYLE[mode] ?? MODE_STYLE.read}`}>
      {MODE_LABEL[mode] ?? MODE_LABEL.read}
    </span>
  )
}

function AdminTag() {
  return <span className="badge bg-red-100 text-red-700">admin</span>
}

function SuperAdminTag() {
  return <span className="badge bg-purple-100 text-purple-700">super admin only</span>
}

function TableTag({ name }) {
  return (
    <span className="inline-block bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded border border-slate-200 font-mono mb-1 mr-1">
      {name}
    </span>
  )
}

function PageCard({ page, theme }) {
  return (
    <div className={`card flex flex-col gap-1.5 border-l-[3px] ${theme.borderL}`}>
      {/* header row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-bold text-[13px] text-gray-800">{page.labelTh}</span>
        <ModeTag mode={page.mode} />
        {page.superAdminOnly ? <SuperAdminTag /> : page.adminOnly && <AdminTag />}
      </div>

      {/* path + component */}
      <div className="flex gap-2 flex-wrap items-center">
        <code className="text-[11px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">{page.path}</code>
        <span className="text-[11px] text-gray-500">→ {page.label}</span>
      </div>

      {/* desc */}
      <p className="text-xs text-gray-600 leading-relaxed">{page.desc}</p>

      {/* tables */}
      <div className="mt-0.5">
        {page.tables.map(t => <TableTag key={t} name={t} />)}
        {page.external && (
          <span className="inline-block bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0.5 rounded border border-orange-200 font-mono mb-1 mr-1">
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
    <div className="max-w-[1100px] mx-auto px-7 py-6">

      {/* Title */}
      <div className="mb-7">
        <h1 className="text-xl font-extrabold text-cocoa-800">System Architecture</h1>
        <p className="text-gray-500 mt-1 text-sm">
          โครงสร้างระบบ BSK coffee&bakery — แอพ, หน้า, ตาราง Supabase และกฎการคำนวณ
        </p>
      </div>

      {/* Legend */}
      <div className="flex gap-2.5 flex-wrap mb-6">
        {LEGEND.map(s => (
          <span key={s.label} className={`badge ${s.className}`}>{s.label}</span>
        ))}
      </div>

      {/* Role Tiers */}
      <section className="mb-8">
        <h2 className="text-[15px] font-bold text-gray-700 mb-3.5 border-b-2 border-gray-200 pb-2">
          🔐 ระดับสิทธิ์ผู้ใช้งาน (profiles.role)
        </h2>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {ROLE_TIERS.map(t => (
            <div key={t.role} className={`rounded-lg border px-3.5 py-2.5 ${t.className}`}>
              <p className="font-bold text-[13px] mb-1">{t.label}</p>
              <p className="text-xs leading-relaxed opacity-90">{t.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2.5">
          บังคับใช้ผ่าน route guard ใน <code className="bg-slate-100 px-1 py-0.5 rounded">App.jsx</code> (AdminPageRoute / SystemRoute / StaffPageRoute)
          {' '}และ RPC <code className="bg-slate-100 px-1 py-0.5 rounded">change_user_role</code> ฝั่ง Supabase
          {' '}(ดู super_admin_migration.sql, admin_page_access_migration.sql)
        </p>
      </section>

      {/* Apps */}
      {APPS.map(app => (
        <section key={app.id} className="mb-8">
          {/* App header */}
          <div className={`rounded-xl px-4.5 py-3 mb-3.5 flex items-center gap-3 border ${app.theme.bg} ${app.theme.border}`}>
            <div>
              <span className={`font-extrabold text-base ${app.theme.text}`}>{app.label}</span>
              <span className="ml-2 text-xs text-gray-500">—</span>
              <a href={`https://${app.sublabel}`} target="_blank" rel="noreferrer"
                className={`ml-1.5 text-xs no-underline opacity-80 ${app.theme.text}`}>
                {app.sublabel}
              </a>
            </div>
            <span className={`ml-auto badge border ${app.theme.badgeBg} ${app.theme.badgeText} ${app.theme.badgeBorder}`}>
              {app.pages.length} หน้า
            </span>
          </div>

          {/* Page grid */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {app.pages.map(page => (
              <PageCard key={page.path} page={page} theme={app.theme} />
            ))}
          </div>
        </section>
      ))}

      {/* GP Calculation Rules */}
      <section className="mb-8">
        <h2 className="text-[15px] font-bold text-gray-700 mb-3.5 border-b-2 border-gray-200 pb-2">
          🧮 กฎการคำนวณ GP (5-Layer Profit)
        </h2>
        <div className="flex flex-col">
          {CALC_RULES.map((r, i) => (
            <div key={r.step} className="flex items-start">
              {/* connector */}
              <div className="flex flex-col items-center w-8 shrink-0">
                <div className={`w-7 h-7 rounded-full border-2 border-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-700 ${r.bg}`}>
                  {i + 1}
                </div>
                {i < CALC_RULES.length - 1 && (
                  <div className="w-0.5 h-5 bg-gray-200 my-0.5" />
                )}
              </div>
              {/* content */}
              <div className={`border border-gray-200 rounded-lg px-3.5 py-2 ml-2.5 flex-1 ${r.bg} ${i < CALC_RULES.length - 1 ? 'mb-1' : ''}`}>
                <div className="flex gap-2 items-baseline flex-wrap">
                  <span className="font-bold text-[13px] text-gray-800">{r.label}</span>
                  <code className="text-xs text-gray-700 bg-white/60 px-1.5 py-0.5 rounded">{r.formula}</code>
                </div>
                {r.note && (
                  <p className="text-[11px] text-amber-800 mt-1 italic">⚠️ {r.note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2.5">
          ใช้ใน: <code className="bg-slate-100 px-1 py-0.5 rounded">src/utils/calculations.js → calcPlatformProfit()</code>
          {' · '}เรียกจาก DashboardPage, SalesHistoryPage, SalesEntryPage
        </p>
      </section>

      {/* Supabase Tables */}
      <section className="mb-8">
        <h2 className="text-[15px] font-bold text-gray-700 mb-3.5 border-b-2 border-gray-200 pb-2">
          🗄️ Supabase Tables
        </h2>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {TABLES.map(t => (
            <div key={t.name} className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs font-bold text-purple-600">{t.name}</code>
              </div>
              <p className="text-xs text-gray-600 mb-1.5">{t.desc}</p>
              <p className="text-[10px] text-gray-400 font-mono leading-relaxed">{t.cols}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Data Flow Note */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 mb-4">
        <h2 className="text-sm font-bold text-gray-700 mb-2.5">🔄 Data Flow หลัก</h2>
        <div className="flex flex-col gap-2">
          {DATA_FLOW.map((f, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <span className="bg-sky-100 text-sky-800 text-[11px] px-2.5 py-0.5 rounded font-semibold">{f.from}</span>
              <span className="text-gray-500 text-sm font-bold">{f.arrow}</span>
              <code className="bg-slate-100 text-gray-700 text-[11px] px-2 py-0.5 rounded">{f.to}</code>
              <span className="text-[11px] text-gray-500">— {f.note}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-[11px] text-gray-300 text-right">
        BSK coffee&bakery · System Architecture · อัปเดต {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}
