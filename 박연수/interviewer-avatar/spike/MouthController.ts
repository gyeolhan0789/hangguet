// 립싱크 보간은 여기서만 한다 (decisions.md). 출력: jawOpen(음량) 또는 viseme_*(HeadAudio)
import { clamp, expFactor } from './math.ts';

export const MOUTH_OPEN_TAU = 0.05;
export const MOUTH_CLOSE_TAU = 0.12;
const NOISE_GATE = 0.01;
const GAIN = 6;

/** Oculus viseme 모프 14종. viseme_sil(무음, 입 다문 기본형)은 새 모델에는 있지만 쓰지 않는다 */
export const VISEME_MORPHS = [
  'viseme_aa',
  'viseme_E',
  'viseme_I',
  'viseme_O',
  'viseme_U',
  'viseme_PP',
  'viseme_SS',
  'viseme_TH',
  'viseme_DD',
  'viseme_FF',
  'viseme_kk',
  'viseme_nn',
  'viseme_RR',
  'viseme_CH',
] as const;

/** 음량 원본(RMS 0~1) → 입 벌림 목표 */
export function volumeToMouth(volume: number): number {
  return clamp((volume - NOISE_GATE) * GAIN, 0, 1);
}

const approach = (cur: number, target: number, dt: number) => {
  const tau = target > cur ? MOUTH_OPEN_TAU : MOUTH_CLOSE_TAU;
  const v = cur + (target - cur) * expFactor(dt, tau);
  return v < 1e-4 ? 0 : v;
};

export class MouthController {
  private value = 0;
  private visemes: Record<string, number> = {};

  /** jawOpen 출력값 */
  get aa(): number {
    return this.value;
  }

  get jawOpen(): number {
    return this.value;
  }

  /** volume: 음량 원본 값(0~1). text 모드·HeadAudio 사용 중에는 0 을 넣는다 */
  update(dt: number, volume: number): number {
    this.value = approach(this.value, volumeToMouth(volume), dt);
    return this.value;
  }

  /**
   * HeadAudio 의 viseme 목표값(0~1)을 같은 열림/닫힘 시정수로 보간.
   * 목록에 없는 이름(viseme_sil 등)은 버린다. 빠진 viseme 는 0 으로 닫힌다
   */
  updateVisemes(dt: number, targets: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of VISEME_MORPHS) {
      const target = clamp(targets[name] ?? 0, 0, 1);
      const v = approach(this.visemes[name] ?? 0, target, dt);
      if (v > 0) out[name] = v;
    }
    this.visemes = out;
    return out;
  }

  reset(): void {
    this.value = 0;
    this.visemes = {};
  }
}
