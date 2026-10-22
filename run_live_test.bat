@echo off
title ReturnPilot GST Portal Live Automated Backtest
color 0B
echo ===========================================================================
echo       ReturnPilot Automated GST Portal Live Test Runner
echo ===========================================================================
echo.
cd /d "%~dp0"
python tests\selenium_backtest_suite.py --live
echo.
echo ===========================================================================
echo  Test execution finished. Press any key to exit.
echo ===========================================================================
pause
