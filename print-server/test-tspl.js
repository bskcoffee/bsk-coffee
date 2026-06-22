const net = require('net')

const PRINTER_IP   = '192.168.68.126'
const PRINTER_PORT = 9100

// TSPL test label — 50mm x 30mm
const tspl = [
  'SIZE 50 mm, 30 mm',
  'GAP 2 mm, 0 mm',
  'CLS',
  'TEXT 25,10,"3",0,1,1,"TEST PRINT"',
  'TEXT 25,60,"2",0,1,1,"Cocoa House"',
  'TEXT 25,100,"2",0,1,1,"12:00  #TEST"',
  'PRINT 1,1',
  ''
].join('\r\n')

const socket = new net.Socket()
socket.setTimeout(5000)

socket.connect(PRINTER_PORT, PRINTER_IP, () => {
  console.log('Connected to printer')
  socket.write(tspl, 'ascii', () => {
    console.log('TSPL sent — check if label printed')
    socket.end()
  })
})

socket.on('error', err => console.error('Error:', err.message))
socket.on('timeout', () => { console.error('Timeout'); socket.destroy() })
socket.on('close', () => console.log('Done'))
