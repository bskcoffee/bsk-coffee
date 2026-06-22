const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT = 4173
const DIST = path.join(__dirname, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
}

http.createServer((req, res) => {
  // ตัด query string
  let urlPath = req.url.split('?')[0]
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)

  // SPA fallback — ถ้าไม่มีไฟล์ให้ serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }

  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}).listen(PORT, '0.0.0.0', () => {
  console.log(`cocoa-pos running at http://0.0.0.0:${PORT}`)
})
