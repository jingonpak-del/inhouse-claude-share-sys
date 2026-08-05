<#
.SYNOPSIS
  사내 Claude 세션 대시보드를 NSSM으로 Windows 서비스에 등록합니다.

.DESCRIPTION
  이 스크립트는 관리자 권한 PowerShell에서 사용자가 직접 실행해야 합니다.
  실행 전에 준비할 것:
    1) NSSM (https://nssm.cc) 이 설치되어 PATH에서 nssm.exe 를 찾을 수 있어야 함
    2) 이 서비스가 "claude login"으로 이미 인증된 Windows 계정으로 실행되도록,
       그 계정의 사용자명/비밀번호를 미리 준비해둘 것
    3) 그 계정에 로컬 보안 정책 > "로그온 서비스로(Log on as a service)" 권한이
       부여되어 있어야 함 (secpol.msc 에서 수동으로 설정, 아래 안내 참고)

.PARAMETER ServiceAccount
  서비스가 실행될 Windows 계정 (예: ".\claudebot" 또는 "COMPANY\claudebot")

.EXAMPLE
  .\install-service.ps1 -ServiceAccount ".\claudebot"
#>

param(
  [string]$ServiceName = "ClaudeDashboard",
  [Parameter(Mandatory = $true)]
  [string]$ServiceAccount
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Error "관리자 권한 PowerShell에서 다시 실행하세요."
  exit 1
}

$nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
if (-not $nssm) {
  Write-Error "nssm.exe를 찾을 수 없습니다. https://nssm.cc 에서 내려받아 PATH에 추가한 뒤 다시 실행하세요."
  exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot "server"
$distEntry = Join-Path $serverDir "dist\index.js"

Write-Host "== 빌드 ==" -ForegroundColor Cyan
Push-Location $repoRoot
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install 실패" }
  npm run build:client
  if ($LASTEXITCODE -ne 0) { throw "클라이언트 빌드 실패" }
  npm run build:server
  if ($LASTEXITCODE -ne 0) { throw "서버 빌드 실패" }
}
finally {
  Pop-Location
}

if (-not (Test-Path $distEntry)) {
  Write-Error "빌드 결과($distEntry)를 찾을 수 없습니다."
  exit 1
}

if (-not (Test-Path (Join-Path $serverDir ".env"))) {
  Write-Warning "$serverDir\.env 파일이 없습니다. .env.example을 복사해 값을 채워두세요."
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Error "node.exe를 찾을 수 없습니다."
  exit 1
}
$nodePath = $nodeCmd.Source

$securePassword = Read-Host -Prompt "서비스 계정($ServiceAccount) 비밀번호 입력" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

Write-Host "== 서비스 등록: $ServiceName ==" -ForegroundColor Cyan

$existing = nssm status $ServiceName 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "기존 서비스가 발견되어 제거 후 다시 등록합니다." -ForegroundColor Yellow
  nssm stop $ServiceName 2>$null | Out-Null
  nssm remove $ServiceName confirm | Out-Null
}

nssm install $ServiceName $nodePath "--env-file-if-exists=.env dist\index.js"
nssm set $ServiceName AppDirectory $serverDir
nssm set $ServiceName ObjectName $ServiceAccount $plainPassword
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppStdout (Join-Path $serverDir "service-stdout.log")
nssm set $ServiceName AppStderr (Join-Path $serverDir "service-stderr.log")
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 1048576

Remove-Variable plainPassword
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

Write-Host "== 서비스 시작 ==" -ForegroundColor Cyan
nssm start $ServiceName

Write-Host ""
Write-Host "등록 완료. 상태 확인: nssm status $ServiceName" -ForegroundColor Green
Write-Host "로그 위치: $serverDir\service-stdout.log / service-stderr.log"
Write-Host ""
Write-Host "※ '$ServiceAccount' 계정에 '로그온 서비스로' 권한이 없으면 시작이 실패합니다." -ForegroundColor Yellow
Write-Host "   secpol.msc → 로컬 정책 → 사용자 권한 할당 → '서비스로 로그온' 에서 계정을 추가하세요."
Write-Host "※ 그 계정으로 이 컴퓨터에 로그인해 'claude login'을 최소 한 번 완료해 두어야" -ForegroundColor Yellow
Write-Host "   서비스 실행 시 Claude 인증이 유지됩니다."
