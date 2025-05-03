@echo off
echo Starting Node.js scripts...

:: Launch first Command Prompt for married.js
start "Married Checker" cmd /k node married.js

:: Launch second Command Prompt for unmarried.js
start "Unmarried Checker" cmd /k node unmarried.js

echo Scripts launched in separate windows.
exit