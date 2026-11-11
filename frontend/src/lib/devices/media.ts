// S05 장치 점검에서 쓰는 브라우저 미디어 계산. 서버를 부르지 않는다.
// 기준: Figma S05(18:2333) 체크 줄 · 마이크 레벨 · S05-E(18:4013) 권한 거부
// · 모션 메모 S05(18:2492: 마이크 레벨은 실제 입력 볼륨에 맞춰 막대 높이 실시간)
// · MDN getUserMedia 오류(NotAllowedError · NotFoundError · NotReadableError …) · AnalyserNode.getFloatTimeDomainData

/** 장치 점검 실패 이유. denied 권한 거부(S05-E) · missing 장치 없음 · busy 다른 앱이 사용 중 · ended 점검 중 연결 끊김 · unsupported 브라우저가 지원 안 함 */
export type DeviceFailure = "denied" | "missing" | "busy" | "ended" | "unsupported";

/** 체크 줄 하나의 상태 */
export type CheckStatus = "checking" | "ok" | DeviceFailure;

/** getUserMedia 오류를 체크 줄 상태로 바꾼다(MDN getUserMedia Exceptions). */
export function mediaFailure(error: unknown): DeviceFailure {
  // getUserMedia는 DOMException을 던진다. 환경에 따라 Error를 상속하지 않을 수 있어 name만 본다.
  const name =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  switch (name) {
    // 사용자가 거부했거나 브라우저 · 정책이 막았다
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    // 장치가 없거나 조건에 맞는 장치가 없다
    case "NotFoundError":
    case "OverconstrainedError":
      return "missing";
    // 다른 앱이 쓰고 있거나 하드웨어 문제로 열 수 없다(Firefox는 AbortError)
    case "NotReadableError":
    case "AbortError":
      return "busy";
    default:
      // HTTPS가 아니어서 mediaDevices가 없는 경우 등
      return "unsupported";
  }
}

/** 이보다 작은 소리는 0(막대 없음) */
const SILENCE_DB = -60;
/** 이보다 큰 소리는 1(막대 가득) */
const LOUD_DB = -10;

/**
 * 마이크 입력 한 묶음(-1~1)의 소리 크기를 0~1로 바꾼다.
 * RMS를 dB로 바꿔 -60dB → 0, -10dB → 1 사이로 펴서, 작은 목소리도 막대가 움직이게 한다.
 */
export function micLevel(samples: ArrayLike<number> & Iterable<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - SILENCE_DB) / (LOUD_DB - SILENCE_DB)));
}
