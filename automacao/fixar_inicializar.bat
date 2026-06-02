@echo off
setlocal

REM Se estiver rodando no PowerShell, relanca no CMD
if not "%PSModulePath%"=="" (
  cmd /c "%~f0"
  exit /b
)

title Fixar Automacao na Area de Trabalho 1
color 0A

echo:
echo  =============================================
echo   FIXANDO AUTOMACAO NA AREA DE TRABALHO 1
echo  =============================================
echo:

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SCRIPT=%~dp0iniciar.bat"
set "ATALHO=%STARTUP%\Automacao Agenda Conexa.lnk"

powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%ATALHO%'); $s.TargetPath='%SCRIPT%'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=1; $s.Description='Automacao Agenda Conexa Saude'; $s.Save()"

if exist "%ATALHO%" (
  echo  [OK] Atalho criado - vai abrir automaticamente com o Windows
) else (
  echo  [ERRO] Nao foi possivel criar o atalho
)

echo:
echo  Iniciando monitoramento agora...
echo:

start "Automacao Agenda - Conexa Saude" /D "%~dp0" cmd /k "color 0A && title Automacao Agenda - Conexa Saude && echo: && echo  ============================================= && echo   AUTOMACAO DE AGENDA - CONEXA SAUDE && echo   Monitoramento: seg-sex 07h-17h ^| 20 min && echo  ============================================= && echo: && node executar.js"

echo:
echo  Pronto! Janela aberta na Area de Trabalho 1.
echo:
pause
endlocal
