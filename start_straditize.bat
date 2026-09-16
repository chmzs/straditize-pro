@echo off
chcp 65001 >nul
title Straditize - 地学图谱交互数字化系统 (Modern GeoDigitizer)

echo ======================================================================
echo   🚀 正在启动 Straditize Pro 桌面模式
echo   • 架构: Python 科学内核 + 120 FPS 现代视口
echo   • 模式: 桌面单实例，自动选端口，静默启动浏览器
echo ======================================================================

pixi run desktop

pause
