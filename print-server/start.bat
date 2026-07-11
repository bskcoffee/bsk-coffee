@echo off
title BSK coffee Print Server
echo.
echo  ==============================
echo   BSK coffee Print Server
echo  ==============================
echo.

if not exist ".env" (
  echo [!] ยังไม่มีไฟล์ .env
  echo     กรุณา copy .env.example เป็น .env แล้วใส่ IP เครื่องพิมพ์ก่อน
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [*] ติดตั้ง dependencies ก่อนครั้งแรก...
  npm install
  echo.
)

echo [*] เริ่มต้น print server...
echo     กด Ctrl+C เพื่อหยุด
echo.
node server.js
pause
