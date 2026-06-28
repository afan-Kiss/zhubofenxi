@echo off
chcp 65001 >nul
title 主播分析-外网隧道

:loop
echo [%date% %time%] 连接 VPS 隧道...
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:14723:127.0.0.1:4723 zhubofenxi-vps
echo.
echo [%date% %time%] 隧道断开，10 秒后重连...
timeout /t 10 /nobreak >nul
goto loop
