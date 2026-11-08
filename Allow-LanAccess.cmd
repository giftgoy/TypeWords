@echo off
chcp 65001 >nul
rem 给 TypeWords 的 5567 端口加一条只对「本地子网 + 专用网络」生效的入站规则
rem 双击运行，弹出 UAC 时选“是”

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 需要管理员权限，正在申请提权...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="TypeWords 局域网访问 (TCP 5567)" >nul 2>&1
netsh advfirewall firewall add rule ^
  name="TypeWords 局域网访问 (TCP 5567)" ^
  dir=in action=allow protocol=TCP localport=5567 ^
  profile=private remoteip=localsubnet ^
  description="允许同一局域网的平板/手机访问 TypeWords（仅专用网络、仅本地子网）"

if %errorlevel% equ 0 (
  echo.
  echo 已放行 TCP 5567（专用网络 / 本地子网）。
  echo 查看本机访问地址：
  powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '  http://' + $_.IPAddress + ':5567' }"
) else (
  echo 添加规则失败，请检查是否以管理员身份运行。
)
echo.
pause
