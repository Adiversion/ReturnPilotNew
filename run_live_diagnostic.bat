@echo off
title ReturnPilot GST Portal Live Diagnostic & Support Inquiry Auditor
color 0B
cls
echo ===========================================================================
echo       ReturnPilot GST Portal Live Diagnostic & Support Audit Runner
echo ===========================================================================
echo.
echo  This tool performs an empirical end-to-end live diagnosis on the GST Portal,
echo  investigating all 6 issues raised in support submissions:
echo    1. Incorrect Amounts (Validates API data vs Rendered PDF/Excel)
echo    2. Missing Monthly Data (Audits Filing History, QRMP & Unfiled Months)
echo    3. Incorrect Tax Period (Detects Angular Scope & Storage Period Bleed)
echo    4. Incomplete Downloads (Audits DocData Invoices & Pagination Cutoffs)
echo    5. Download Failures (Benchmarks Portal Subdomain Latency & Timeouts)
echo    6. Bulk 'PDF All' Trigger (Verifies Sequential Queue & Click Handlers)
echo.
echo ===========================================================================
echo  Select an option:
echo ===========================================================================
echo  [1] Run Complete Live Diagnostic Battery (Default: FY 2024-25)
echo  [2] Run Live Diagnostic for Specific Financial Year (Prompt for FY)
echo  [3] Run Standard Live Selenium Backtest Suite
echo  [4] Exit
echo ===========================================================================
set /p opt="Enter your choice (1-4) [default: 1]: "

if "%opt%"=="" set opt=1
if "%opt%"=="1" goto RUN_DEFAULT
if "%opt%"=="2" goto RUN_CUSTOM_FY
if "%opt%"=="3" goto RUN_STANDARD_BACKTEST
if "%opt%"=="4" goto EXIT_SCRIPT

:RUN_DEFAULT
echo.
echo Starting Full Live Diagnostic Battery for FY 2024-25...
cd /d "%~dp0"
python tests\diagnostic_live_audit_suite.py --live --fy 2024-25
goto FINISH

:RUN_CUSTOM_FY
echo.
set /p target_fy="Enter Target Financial Year (e.g., 2023-24, 2024-25, 2026-27): "
if "%target_fy%"=="" set target_fy=2024-25
echo Starting Live Diagnostic Battery for FY %target_fy%...
cd /d "%~dp0"
python tests\diagnostic_live_audit_suite.py --live --fy %target_fy%
goto FINISH

:RUN_STANDARD_BACKTEST
echo.
echo Starting Standard Live Selenium Backtest Suite...
cd /d "%~dp0"
python tests\selenium_backtest_suite.py --live
goto FINISH

:FINISH
echo.
echo ===========================================================================
echo  Execution completed. Check 'tests\reports\live_diagnostic_audit_report.md'
echo  for complete comparative insights. Press any key to exit.
echo ===========================================================================
pause
exit /b

:EXIT_SCRIPT
exit /b
