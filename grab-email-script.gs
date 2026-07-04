// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Grab Daily Report → Cocoa House Auto-Import                        ║
// ║  วิธีใช้:                                                           ║
// ║  1. ไปที่ script.google.com → สร้าง project ใหม่                   ║
// ║  2. วาง code นี้ แทนที่ code เดิม                                   ║
// ║  3. Project Settings → Script Properties → เพิ่ม 3 properties:     ║
// ║     SUPABASE_URL  = https://xxxx.supabase.co                        ║
// ║     SUPABASE_KEY  = eyJxxxx... (anon key)                           ║
// ║     PARSE_SECRET  = (ค่าเดียวกับ CRON_SECRET ใน Vercel)            ║
// ║  4. Run parseGrabEmail() ครั้งแรก → กด Authorize                   ║
// ║  5. Triggers → Add trigger → parseGrabEmail → Time-driven → Day   ║
// ║     → เวลา 15:00–16:00                                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

var GRAB_PARSE_API_URL = 'https://cocoa-house.vercel.app/api/parse-grab-pdf'

function getProps() {
  var props = PropertiesService.getScriptProperties()
  return {
    supabaseUrl: props.getProperty('SUPABASE_URL'),
    supabaseKey: props.getProperty('SUPABASE_KEY'),
    parseSecret: props.getProperty('PARSE_SECRET'),
  }
}

// ── Main function (รัน daily หรือ manual) ───────────────────────────────────

function parseGrabEmail() {
  var props = getProps()

  // ค้นหา email รายงาน Grab ที่มี PDF แนบ (ย้อนหลัง 3 วัน)
  var threads = GmailApp.search(
    'from:no-reply@grab.com subject:สรุปยอดขายสำหรับคำสั่งซื้อ has:attachment newer_than:3d',
    0, 10
  )

  if (threads.length === 0) {
    Logger.log('ไม่พบ email รายงาน Grab')
    return
  }

  var processed = 0

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages()

    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j]
      var attachments = msg.getAttachments()

      // หา PDF attachment
      var pdfAttachment = null
      for (var k = 0; k < attachments.length; k++) {
        if (attachments[k].getContentType() === 'application/pdf') {
          pdfAttachment = attachments[k]
          break
        }
      }

      if (!pdfAttachment) continue

      Logger.log('พบ PDF: ' + pdfAttachment.getName() + ' (' + msg.getDate() + ')')

      // แปลง PDF เป็น base64
      var pdfBase64 = Utilities.base64Encode(pdfAttachment.getBytes())

      // ส่งไป Vercel ให้ parse + บันทึก Supabase อัตโนมัติ (saveToDb=true)
      var parseResp = UrlFetchApp.fetch(GRAB_PARSE_API_URL, {
        method:          'post',
        contentType:     'application/json',
        headers:         { 'x-parse-secret': props.parseSecret },
        payload:         JSON.stringify({ pdfBase64: pdfBase64, saveToDb: true, filename: pdfAttachment.getName() }),
        muteHttpExceptions: true,
      })

      var code = parseResp.getResponseCode()
      var body = parseResp.getContentText()

      if (code !== 200) {
        Logger.log('❌ Parse ล้มเหลว (' + code + '): ' + body)
        continue
      }

      var result = JSON.parse(body)
      Logger.log(
        '✅ ' + result.date +
        ' | advert=' + result.advertisement +
        ' | mkt=' + result.marketing_fee +
        ' | campaign=' + result.campaign +
        ' | action=' + result.action
      )
      processed++
    }
  }

  Logger.log('เสร็จแล้ว: บันทึก ' + processed + ' วัน')
}

// ── Backfill: อ่าน email ย้อนหลังตั้งแต่วันที่กำหนด ────────────────────────
// วิธีใช้: กด Run ที่ function นี้ได้เลย (รันครั้งเดียว)

function backfillFromJan2026() {
  var props = getProps()

  var threads = GmailApp.search(
    'from:no-reply@grab.com subject:สรุปยอดขายสำหรับคำสั่งซื้อ has:attachment after:2026/1/1',
    0, 200
  )

  Logger.log('พบ ' + threads.length + ' threads')

  var processed = 0

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages()

    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j]
      var attachments = msg.getAttachments()

      var pdfAttachment = null
      for (var k = 0; k < attachments.length; k++) {
        if (attachments[k].getContentType() === 'application/pdf') {
          pdfAttachment = attachments[k]
          break
        }
      }

      if (!pdfAttachment) continue

      Logger.log('กำลังประมวลผล: ' + pdfAttachment.getName())

      var pdfBase64 = Utilities.base64Encode(pdfAttachment.getBytes())

      var parseResp = UrlFetchApp.fetch(GRAB_PARSE_API_URL, {
        method:          'post',
        contentType:     'application/json',
        headers:         { 'x-parse-secret': props.parseSecret },
        payload:         JSON.stringify({ pdfBase64: pdfBase64, saveToDb: true, filename: pdfAttachment.getName() }),
        muteHttpExceptions: true,
      })

      var code = parseResp.getResponseCode()
      var body = parseResp.getContentText()

      if (code !== 200) {
        Logger.log('❌ (' + code + '): ' + body)
        continue
      }

      var result = JSON.parse(body)
      Logger.log(
        '✅ ' + result.date +
        ' | advert=' + result.advertisement +
        ' | mkt=' + result.marketing_fee +
        ' | campaign=' + result.campaign +
        ' | action=' + result.action
      )
      processed++
    }
  }

  Logger.log('เสร็จแล้ว: บันทึก ' + processed + ' วัน')
}

// ── Manual backfill: ส่ง PDF ที่ดาวน์โหลดมาเองใน Google Drive ─────────────
// วิธีใช้: อัปโหลด PDF ไป Google Drive แล้ว copy fileId มาใส่ แล้ว Run

function parseFromDrive(fileId) {
  var props = getProps()
  var file = DriveApp.getFileById(fileId)
  var pdfBase64 = Utilities.base64Encode(file.getBlob().getBytes())

  var parseResp = UrlFetchApp.fetch(GRAB_PARSE_API_URL, {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'x-parse-secret': props.parseSecret },
    payload:         JSON.stringify({ pdfBase64: pdfBase64, saveToDb: true, filename: file.getName() }),
    muteHttpExceptions: true,
  })

  var result = JSON.parse(parseResp.getContentText())
  Logger.log(JSON.stringify(result, null, 2))
  return result
}
