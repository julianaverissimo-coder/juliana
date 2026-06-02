@echo off
title Automacao Agenda - Conexa Saude
color 0A
mode con cols=100 lines=35

REM Posiciona a janela no canto superior esquerdo da Area de Trabalho 1
powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h,IntPtr i,int x,int y,int cx,int cy,uint f); [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; $h=[W]::GetConsoleWindow(); [W]::SetWindowPos($h,[IntPtr]::Zero,50,50,980,620,0x0040);" 2>nul

echo.
echo  =============================================
echo   AUTOMACAO DE AGENDA - CONEXA SAUDE
echo   Monitoramento: seg-sex 07h-17h
echo   Verificacao a cada 20 minutos
echo  =============================================
echo.
node executar.js
echo.
echo  Processo encerrado.
pause
