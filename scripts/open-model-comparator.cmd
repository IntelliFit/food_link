@echo off
cd /d "%~dp0.."
echo Starting the five-way model comparator. Keep this window open.
node scripts\model-compare.mjs --open
pause
