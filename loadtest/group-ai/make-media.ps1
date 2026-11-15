# 그룹 면접 측정(report/group-ai-2026-11-15.md)용 가짜 마이크 파일 u1 · u2 · u3.wav를 만든다. Windows PowerShell에서 한 번 실행한다.
#   .\loadtest\group-ai\make-media.ps1         # 짧은 답변(하나에 평균 8~10초): u1 · u2 · u3.wav
#   .\loadtest\group-ai\make-media.ps1 -Long   # 긴 답변(하나에 약 60초): u1-long · u2-long · u3-long.wav
# - 참가자마다 주제가 다른 답변 5개(answers.json)를 Windows 음성 합성(ko-KR)으로 생성하고 답변 사이에 8초 침묵을 추가한다.
#   -Long은 답변 5개와 첫 답변을 이어 하나의 답변으로 만든다. 짧은 답변은 질문이 자주 이어져
#   실제 사용(화상 답변 최대 2분)보다 에이전트 부하가 크게 측정될 수 있으므로, 같은 내용으로 길이만 늘려 비교하기 위함이다.
#   주제를 나눈 이유: 답변자 전사에 다른 참가자의 낱말(answers.json의 keywords)이 나오면 섞인 것으로 집계하기 위함이다.
# - 음 높이를 참가자마다 다르게 해 녹화를 들었을 때 누구 목소리인지 구분되게 한다.
# - Chromium은 파일을 반복 재생하므로 차례가 아닌 참가자도 계속 발화하는 상태가 된다(목소리 섞임 측정의 조건).
# 카메라 파일(media/camera.y4m)은 얼굴이 아닌 영상이면 되므로 loadtest/media/make-media.ps1의 camera.y4m을 복사해 사용한다.
# 생성한 파일은 커밋하지 않는다(loadtest/.gitignore).
param([switch]$Long)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$outDir = Join-Path $PSScriptRoot 'media'
New-Item -ItemType Directory -Force $outDir | Out-Null
$sampleRate = 48000
$silenceSeconds = 8
$spec = Get-Content (Join-Path $PSScriptRoot 'answers.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
if (-not $voice) { throw '한국어 음성(ko-KR)이 없다. Windows 설정 → 시간 및 언어 → 음성에서 한국어 음성을 추가한다' }
$voiceName = $voice.VoiceInfo.Name
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($sampleRate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function Write-Wav([string]$path, [byte[]]$data, [int]$rate) {
  $fs = [System.IO.File]::Create($path)
  $w = New-Object System.IO.BinaryWriter($fs)
  $w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $data.Length)); $w.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
  $w.Write([Text.Encoding]::ASCII.GetBytes('fmt ')); $w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1)
  $w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
  $w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$data.Length); $w.Write($data)
  $w.Close()
}

$silence = New-Object byte[] ($sampleRate * 2 * $silenceSeconds)
foreach ($p in $spec.participants) {
  $pcm = New-Object System.IO.MemoryStream
  $texts = if ($Long) { @((@($p.answers) + $p.answers[0]) -join ' ') } else { $p.answers }
  foreach ($text in $texts) {
    $part = New-Object System.IO.MemoryStream
    $synth.SetOutputToAudioStream($part, $format)
    $ssml = "<speak version='1.0' xml:lang='ko-KR' xmlns='http://www.w3.org/2001/10/synthesis'><voice name='$voiceName'><prosody pitch='$($p.pitch)'>$text</prosody></voice></speak>"
    $synth.SpeakSsml($ssml)
    $synth.SetOutputToNull()
    $bytes = $part.ToArray()
    $pcm.Write($bytes, 0, $bytes.Length)
    $pcm.Write($silence, 0, $silence.Length)
  }
  $name = if ($Long) { "$($p.id)-long" } else { $p.id }
  $path = Join-Path $outDir "$name.wav"
  $data = $pcm.ToArray()
  Write-Wav $path $data $sampleRate
  '{0}: {1:N1}초' -f $path, ($data.Length / 2 / $sampleRate)
}
$synth.Dispose()
