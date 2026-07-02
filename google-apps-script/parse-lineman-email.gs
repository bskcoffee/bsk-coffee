// ============================================================
// LINE MAN Wongnai — Daily Report Email Parser
// ============================================================
// ติดตั้ง:
//   1. เปิด script.google.com → New Project
//   2. วางโค้ดนี้ทั้งหมด
//   3. ตั้งค่า PARSE_SECRET (ดูจาก Vercel env: CRON_SECRET)
//   4. Run > parseLineManEmails ครั้งแรกเพื่อ authorize Gmail
//   5. Triggers > Add trigger: parseLineManEmails | Time-driven | Day timer | 7am-8am
// ============================================================

var PARSE_API_URL = 'https://cocoa-house.vercel.app/api/parse-lineman-email'
var PARSE_SECRET  = 'YOUR_CRON_SECRET_HERE'   // ← เปลี่ยนตรงนี้

// ── Main function (ตั้ง trigger วันละครั้ง) ──────────────────────────────────

function parseLineManEmails() {
  // ค้นหาอีเมล LINE MAN ที่ยังไม่ได้ process ภายใน 3 วัน
  var query = 'from:no-reply-merchant@linman.com subject:รายงานยอดขายรายวัน newer_than:3d'
  var threads = GmailApp.search(query)

  if (threads.length === 0) {
    Logger.log('No LINE MAN email found')
    return
  }

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages()
    for (var j = 0; j < messages.length; j++) {
      var message = messages[j]
      processMessage(message)
    }
  }
}

// ── Process single email message ─────────────────────────────────────────────

function processMessage(message) {
  var subject   = message.getSubject()
  var plainBody = message.getPlainBody()

  Logger.log('Processing: ' + subject)

  try {
    var payload = JSON.stringify({
      emailText: plainBody,
      subject:   subject,
      saveToDb:  true,
    })

    var response = UrlFetchApp.fetch(PARSE_API_URL, {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'x-parse-secret': PARSE_SECRET },
      payload:            payload,
      muteHttpExceptions: true,
    })

    var code   = response.getResponseCode()
    var result = JSON.parse(response.getContentText())

    if (code === 200) {
      Logger.log('✅ ' + result.date +
        ' | advertisement=' + result.advertisement +
        ' | marketing_fee=' + result.marketing_fee +
        ' | action=' + result.action)
    } else {
      Logger.log('❌ Error ' + code + ': ' + JSON.stringify(result))
    }

  } catch (err) {
    Logger.log('❌ Exception: ' + err.message)
  }
}

// ── Test function (รันมือได้เลย) ─────────────────────────────────────────────
// ทดสอบโดยไม่ save ลง DB — ดูแค่ว่า parse ถูกมั้ย

function testParseOnly() {
  var query    = 'from:no-reply-merchant@linman.com subject:รายงานยอดขายรายวัน newer_than:7d'
  var threads  = GmailApp.search(query)

  if (threads.length === 0) {
    Logger.log('No email found')
    return
  }

  var message   = threads[0].getMessages()[0]
  var subject   = message.getSubject()
  var plainBody = message.getPlainBody()

  var response = UrlFetchApp.fetch(PARSE_API_URL, {
    method:             'post',
    contentType:        'application/json',
    headers:            { 'x-parse-secret': PARSE_SECRET },
    payload:            JSON.stringify({ emailText: plainBody, subject: subject, saveToDb: false }),
    muteHttpExceptions: true,
  })

  Logger.log('Subject: ' + subject)
  Logger.log('Result: ' + response.getContentText())
}
