<#
.SYNOPSIS
  master(관리자) 계정을 생성하거나 비밀번호를 변경합니다.

.DESCRIPTION
  비밀번호를 화면에 표시하지 않고 입력받아 bcrypt 해시로 DB에 저장합니다.
  .env에 평문 비밀번호를 남기지 않기 위한 스크립트입니다.

  같은 아이디가 이미 있으면 비밀번호만 교체하고,
  없으면 master 권한으로 새로 만듭니다.

.EXAMPLE
  .\set-admin-password.ps1
  .\set-admin-password.ps1 -Username admin
#>

param(
  [string]$Username = "admin",
  [string]$DisplayName = "관리자"
)

$ErrorActionPreference = "Stop"

$repoRoot  = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot "server"

# npm workspaces는 의존성을 저장소 루트로 호이스팅하므로 두 위치를 모두 확인한다.
$hasDeps = (Test-Path (Join-Path $repoRoot "node_modules\bcryptjs")) -or
           (Test-Path (Join-Path $serverDir "node_modules\bcryptjs"))
if (-not $hasDeps) {
  Write-Error "의존성이 설치되어 있지 않습니다. 저장소 루트에서 'npm install'을 먼저 실행하세요."
  exit 1
}

$pw1 = Read-Host -Prompt "'$Username' 계정의 새 비밀번호" -AsSecureString
$pw2 = Read-Host -Prompt "비밀번호 확인" -AsSecureString

function ConvertFrom-SecureStringPlain([Security.SecureString]$s) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$plain1 = ConvertFrom-SecureStringPlain $pw1
$plain2 = ConvertFrom-SecureStringPlain $pw2

if ($plain1 -ne $plain2) {
  Write-Error "두 비밀번호가 일치하지 않습니다."
  exit 1
}
if ($plain1.Length -lt 12) {
  Write-Error "인터넷에 공개되는 서비스이므로 12자 이상으로 설정하세요."
  exit 1
}

# 비밀번호는 인자(명령줄)로 넘기지 않는다 — 프로세스 목록에 노출되기 때문.
# 환경변수로만 전달한다.
$env:__ADMIN_PW = $plain1
$env:__ADMIN_USER = $Username
$env:__ADMIN_NAME = $DisplayName

Remove-Variable plain1, plain2

$script = Join-Path $PSScriptRoot "set-admin-password.mjs"

Push-Location $serverDir
try {
  node $script
  if ($LASTEXITCODE -ne 0) { throw "계정 설정 실패" }
}
finally {
  Pop-Location
  Remove-Item Env:\__ADMIN_PW    -ErrorAction SilentlyContinue
  Remove-Item Env:\__ADMIN_USER  -ErrorAction SilentlyContinue
  Remove-Item Env:\__ADMIN_NAME  -ErrorAction SilentlyContinue
}
