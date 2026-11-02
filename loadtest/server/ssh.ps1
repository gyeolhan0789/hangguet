# PowerShell에서 ssh.sh를 부른다. PowerShell의 bash는 WSL bash일 수 있어(경로가 /mnt/c/...라 키를 못 찾는다) Git Bash를 직접 쓴다.
#   .\loadtest\server\ssh.ps1            # 접속
#   .\loadtest\server\ssh.ps1 'docker ps'
#   .\loadtest\server\ssh.ps1 upload
$gitBash = Join-Path (Split-Path (Split-Path (Get-Command git).Source)) 'bin\bash.exe'
if (-not (Test-Path $gitBash)) { throw "Git Bash가 없다: $gitBash" }
& $gitBash (Join-Path $PSScriptRoot 'ssh.sh') @args
exit $LASTEXITCODE
