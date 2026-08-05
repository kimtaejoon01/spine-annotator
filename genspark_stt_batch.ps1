# ============================================================
# Genspark STT 배치 전사 (Windows PowerShell 용)
# ElevenLabs Scribe v2 사용 · 이미 결제한 젠스파크 크레딧으로 실행
# 실행: PowerShell 창에서  ->  .\genspark_stt_batch.ps1
#   (최초 1회만)  npm install -g @genspark/cli
# ============================================================

# --- 설정 (이미 다 넣어둠) ---------------------------------
$env:GSK_API_KEY = "gsk-eyJjb2dlbl9pZCI6ImU1ZjY3ZWE4LTcwODItNGU5Yy05MzNkLWNkYjA1NGE2N2YwMyIsImtleV9pZCI6ImUyMDY4ZTkwLWRlMmEtNDcxZi05M2I4LTUyYTFiM2U5ZTkyMCIsImN0aW1lIjoxNzg1NTAxMjM0LCJjbGF1ZGVfYmlnX21vZGVsIjpudWxsLCJjbGF1ZGVfbWlkZGxlX21vZGVsIjpudWxsLCJjbGF1ZGVfc21hbGxfbW9kZWwiOm51bGx9fHlP0tv3_RxRWxXiPSiBC5eItd5KwHShiwkc3fxBgutR"

$AudioDir = "Z:\06.증빙모음\##US파마텍\★★USP고소\★★정영선변호사(항소)\USP와의 만남\이성희와 전화녹음"
$Model    = "elevenlabs_scribe_v2"   # 위스퍼로 바꾸려면 "whisper-1"
$OutDir   = Join-Path $AudioDir "transcripts"
# -----------------------------------------------------------

$OutputEncoding = [System.Text.Encoding]::UTF8
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "== 로그인 / 크레딧 확인 ==" -ForegroundColor Cyan
gsk login-info

# 대상 오디오 파일 수집 (확장자는 필요시 추가)
$files = Get-ChildItem -Path $AudioDir -File |
         Where-Object { $_.Extension -in ".m4a", ".mp3", ".wav", ".aac", ".amr" }
Write-Host ("찾은 오디오 파일: {0} 개" -f $files.Count) -ForegroundColor Cyan
if ($files.Count -eq 0) { Write-Host "폴더에 오디오가 없어요. 경로/확장자 확인!" -ForegroundColor Red; exit }

# --- 1) 먼저 1개만 테스트해서 화자(speaker) 필드 들어오는지 확인 ---
$first    = $files[0]
$testJson = Join-Path $OutDir "_test.json"
Write-Host ("== 테스트 전사: {0} ==" -f $first.Name) -ForegroundColor Yellow
gsk transcribe -i "$($first.FullName)" -m $Model | Out-File -Encoding utf8 $testJson

Write-Host "-- JSON에서 화자 필드 검사 --"
$hit = Select-String -Path $testJson -Pattern 'speaker|diariz' | Select-Object -First 5
if ($hit) { $hit; Write-Host "=> 화자 분리 O" -ForegroundColor Green }
else      { Write-Host "=> speaker 필드 안 보임 (화자 분리 X 일 수 있음). _test.json 열어서 눈으로도 확인" -ForegroundColor Red }
Write-Host ("테스트 결과 파일: {0}" -f $testJson)

# --- 2) 전체 배치 ------------------------------------------
Write-Host "== 전체 배치 시작 ==" -ForegroundColor Cyan
foreach ($f in $files) {
    $out = Join-Path $OutDir ($f.BaseName + ".json")
    Write-Host ("  -> {0}" -f $f.BaseName)
    gsk transcribe -i "$($f.FullName)" -m $Model | Out-File -Encoding utf8 $out
}
Write-Host ("완료. 결과: {0}" -f $OutDir) -ForegroundColor Green