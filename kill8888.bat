@echo off
tasklist /FI "PID eq 29952" 2>NUL | findstr 29952 >NUL
if not errorslevel 1 (
    echo killing 29952
    taskkill /F /PID 29952 2>NUL
    timeout /t 3 /nobreak >NUL
)
echo after kill:
tasklist 2>NUL | findstr 29952
netstat -ano | findstr ":8888"
if not errorslevel 1 (
    echo PORT STILL BUSY
) else (
    echo port 8888 free
)
