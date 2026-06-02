@echo off
title Fixar Automacao na Area de Trabalho 1
color 0A

echo.
echo  =============================================
echo   FIXANDO AUTOMACAO NA AREA DE TRABALHO 1
echo  =============================================
echo.

REM Cria atalho na pasta de inicializacao do Windows (abre com o Windows)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SCRIPT=%~dp0iniciar.bat"
set "ATALHO=%STARTUP%\Automacao Agenda Conexa.lnk"

REM Cria o atalho via PowerShell
powershell -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $s = $ws.CreateShortcut('%ATALHO%'); ^
   $s.TargetPath = '%SCRIPT%'; ^
   $s.WorkingDirectory = '%~dp0'; ^
   $s.WindowStyle = 1; ^
   $s.Description = 'Automacao Agenda Conexa Saude'; ^
   $s.Save()"

if exist "%ATALHO%" (
  echo  [OK] Atalho criado em Inicializacao do Windows
  echo       %ATALHO%
) else (
  echo  [ERRO] Nao foi possivel criar o atalho
)

echo.
echo  Abrindo agora na Area de Trabalho 1...
echo.

REM Abre o terminal fixado na Area de Trabalho 1 com posicao e tamanho definidos
powershell -WindowStyle Normal -Command ^
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinPos { [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f); [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; ^
   Start-Sleep -Milliseconds 500; ^
   $hwnd = [WinPos]::GetConsoleWindow(); ^
   [WinPos]::SetWindowPos($hwnd, [IntPtr]::Zero, 50, 50, 900, 600, 0x0040);" 2>nul

REM Inicia o script principal em janela separada posicionada
start "Automacao Agenda - Conexa Saude" /D "%~dp0" cmd /k "color 0A && mode con cols=100 lines=35 && node executar.js"

echo.
echo  Processo iniciado! A janela esta fixada na Area de Trabalho 1.
echo  Para remover da inicializacao automatica, delete o arquivo:
echo  %ATALHO%
echo.
pause
