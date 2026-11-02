# 브라우저 시나리오(S0 · S5)의 가짜 카메라 · 마이크 파일을 만든다(load_test_plan 3.6). Windows PowerShell에서 한 번 실행한다.
#   .\loadtest\media\make-media.ps1
# - answer.wav: 지어낸 한국어 답변(Windows 음성 합성 ko-KR) 뒤에 8초 침묵을 붙인 것을 답변 수만큼 이어 붙인다.
#   에이전트는 7초 침묵이면 답변을 끝내므로(load_test_plan 3.6) 한 바퀴에 답변이 하나씩 제출된다. Chromium은 파일을 반복 재생한다
# - camera.y4m: 회색 바탕에 밝은 사각형이 움직이는 짧은 영상(지어낸 것, 실제 얼굴 아님)
# 만든 파일은 커밋하지 않는다(loadtest/.gitignore).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$outDir = $PSScriptRoot
$sampleRate = 48000
$silenceSeconds = 8

# lib/data.js의 CHAT_ANSWERS와 같은 답변
$answers = @(
  '제가 맡았던 부분은 서버 API와 데이터베이스 설계였습니다. 처음에는 요구사항이 자주 바뀌어 어려웠지만, 변경 이유를 문서로 남기고 팀원과 자주 맞춰 보면서 일정 안에 끝낼 수 있었습니다.',
  '가장 어려웠던 점은 사용자가 몰리는 시간에 응답이 느려지는 문제였습니다. 느린 쿼리를 찾아 인덱스를 추가하고 자주 읽는 값은 캐시에 두어 응답 시간을 절반 정도로 줄였습니다.',
  '의견이 달랐을 때는 먼저 상대가 왜 그렇게 생각하는지 물어보았습니다. 각자의 근거를 표로 정리해 비교했고, 결국 두 의견의 장점을 합친 방법으로 결정했습니다.',
  '실패했던 경험도 있습니다. 배포 전에 테스트를 충분히 하지 않아 오류가 났고, 그 뒤로는 배포 전에 확인할 목록을 만들어 같은 실수를 반복하지 않도록 했습니다.',
  '입사 후에는 먼저 서비스 구조와 운영 방식을 빠르게 익히고 싶습니다. 작은 개선부터 꾸준히 쌓아 팀에 믿음을 주는 개발자가 되겠습니다.'
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
if (-not $voice) { throw '한국어 음성(ko-KR)이 없다. Windows 설정 → 시간 및 언어 → 음성에서 한국어 음성을 추가한다' }
$synth.SelectVoice($voice.VoiceInfo.Name)
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($sampleRate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

$pcm = New-Object System.IO.MemoryStream
$silence = New-Object byte[] ($sampleRate * 2 * $silenceSeconds)
foreach ($text in $answers) {
  $part = New-Object System.IO.MemoryStream
  $synth.SetOutputToAudioStream($part, $format)
  $synth.Speak($text)
  $synth.SetOutputToNull()
  $bytes = $part.ToArray()
  $pcm.Write($bytes, 0, $bytes.Length)
  $pcm.Write($silence, 0, $silence.Length)
}
$synth.Dispose()

function Write-Wav([string]$path, [byte[]]$data, [int]$rate) {
  $fs = [System.IO.File]::Create($path)
  $w = New-Object System.IO.BinaryWriter($fs)
  $w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $data.Length)); $w.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
  $w.Write([Text.Encoding]::ASCII.GetBytes('fmt ')); $w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1)
  $w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
  $w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$data.Length); $w.Write($data)
  $w.Close()
}
$wavPath = Join-Path $outDir 'answer.wav'
$data = $pcm.ToArray()
Write-Wav $wavPath $data $sampleRate
'{0}: {1:N1}초' -f $wavPath, ($data.Length / 2 / $sampleRate)

# 320x240, 15fps, 2초. Y4M(C420jpeg): 프레임마다 Y(W*H) + U(W*H/4) + V(W*H/4)
$width = 320; $height = 240; $fps = 15; $frames = 30
$y4mPath = Join-Path $outDir 'camera.y4m'
$fs = [System.IO.File]::Create($y4mPath)
$header = [Text.Encoding]::ASCII.GetBytes("YUV4MPEG2 W$width H$height F${fps}:1 Ip A1:1 C420jpeg`n")
$fs.Write($header, 0, $header.Length)
$frameTag = [Text.Encoding]::ASCII.GetBytes("FRAME`n")
$chroma = New-Object byte[] ($width * $height / 2)
for ($i = 0; $i -lt $chroma.Length; $i++) { $chroma[$i] = 128 }
for ($f = 0; $f -lt $frames; $f++) {
  $luma = New-Object byte[] ($width * $height)
  for ($i = 0; $i -lt $luma.Length; $i++) { $luma[$i] = 96 }
  $x0 = 100 + [int](40 * [Math]::Sin(2 * [Math]::PI * $f / $frames))
  for ($y = 60; $y -lt 180; $y++) { for ($x = $x0; $x -lt $x0 + 120; $x++) { $luma[$y * $width + $x] = 200 } }
  $fs.Write($frameTag, 0, $frameTag.Length)
  $fs.Write($luma, 0, $luma.Length)
  $fs.Write($chroma, 0, $chroma.Length)
}
$fs.Close()
'{0}: {1}x{2} {3}프레임' -f $y4mPath, $width, $height, $frames
