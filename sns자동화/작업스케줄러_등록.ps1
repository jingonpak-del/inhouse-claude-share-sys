# 더줌 SNS 자동화를 Windows 작업 스케줄러에 등록한다.
#  - 'SNS자동화_10분' : 10분마다 python sns.py tick (예약 발행·초안 만들기·댓글 확인·토큰 갱신)
#  - 'SNS자동화_확인화면' : 로그인할 때 확인 화면 서버(http://localhost:3088) 켜기
# 다시 실행하면 같은 이름의 작업을 덮어쓴다. 지우려면:
#   Unregister-ScheduledTask -TaskName 'SNS자동화_10분' -Confirm:$false
#   Unregister-ScheduledTask -TaskName 'SNS자동화_확인화면' -Confirm:$false

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = (Get-Command python).Source
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'   # 창이 뜨지 않는 파이썬
if (-not (Test-Path $pyw)) { $pyw = $py }

$tick = New-ScheduledTaskAction -Execute $pyw -Argument "`"$dir\sns.py`" tick" -WorkingDirectory $dir
$every10 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 10)
$opt = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'SNS자동화_10분' -Action $tick -Trigger $every10 -Settings $opt -Force | Out-Null

$web = New-ScheduledTaskAction -Execute $pyw -Argument "`"$dir\sns.py`" web" -WorkingDirectory $dir
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$opt2 = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName 'SNS자동화_확인화면' -Action $web -Trigger $logon -Settings $opt2 -Force | Out-Null
Start-ScheduledTask -TaskName 'SNS자동화_확인화면'

Write-Output '등록 완료: SNS자동화_10분, SNS자동화_확인화면'
