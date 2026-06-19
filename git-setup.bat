@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Cocoa House -- Git Setup
echo ========================================
echo.

echo [1/5] Initializing git repo...
git init
git config user.email "chaiyapord.k@gmail.com"
git config user.name "chaiyapord"

echo.
echo [2/5] Staging all files...
git add .

echo.
echo [3/5] Creating first commit...
git commit -m "Initial commit -- Cocoa House POS v1.2.0"

echo.
echo [4/5] Setting remote origin...
git remote add origin https://github.com/chaiyapord/cocoa-house.git
git branch -M main

echo.
echo [5/5] Pushing to GitHub...
echo (username = chaiyapord  |  password = Personal Access Token)
git push -u origin main

echo.
echo ========================================
echo  Done!
echo ========================================
pause
