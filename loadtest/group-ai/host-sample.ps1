# 측정하는 PC(Windows) 전체 CPU · 메모리를 5초마다 CSV로 출력한다(report/group-ai-2026-11-15.md).
# 브라우저(발생기)와 측정 대상(에이전트)이 같은 PC에 있으므로, CPU 80%를 넘은 구간이 많은 회차는 보조 자료로 분류한다(load_test_plan 3.2).
# 메모리는 Docker VM 실행만으로 85%를 넘으므로 기준으로 사용하지 않고, VM 안 메모리 압박 · 스왑(sample.sh)으로 판단한다.
#   powershell -File loadtest\group-ai\host-sample.ps1 1800 > loadtest\results\group-ai\host.csv
param([int]$Duration = 1800)
$end = (Get-Date).AddSeconds($Duration)
'time,host_cpu_pct,host_mem_pct'
while ((Get-Date) -lt $end) {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $os = Get-CimInstance Win32_OperatingSystem
  # 대기 메모리(standby)는 즉시 사용할 수 있으므로 사용 가능 메모리(Available MBytes) 기준으로 계산한다
  $avail = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory).AvailableMBytes * 1024
  $mem = [math]::Round(100 * (1 - $avail / $os.TotalVisibleMemorySize), 1)
  '{0},{1},{2}' -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(), $cpu, $mem
  Start-Sleep -Seconds 5
}
