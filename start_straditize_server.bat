@echo off
chcp 65001 >nul
title Straditize Pro - 服务器模式 (Server Mode)

echo ======================================================================
echo   🌐 正在启动 Straditize Pro 服务器模式
echo   • 绑定: 127.0.0.1:8765
echo   • 安全: 严格本地回环 (外网远程请使用 SSH 端口转发)
echo   • 退出: 请在终端按 Ctrl+C 终止服务
echo ======================================================================

pixi run rpc-server

pause
