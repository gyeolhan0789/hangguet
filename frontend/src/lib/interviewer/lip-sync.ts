import { NEUTRAL_FACE, type Vowel } from "./face-rules";

// 질문 음성의 글자별 발음 시각(AI 명세 6.3 interview.question alignment.chars)으로 면접관 입 모양을 정한다.
// 기준: 면접관 표현 결정 ②(박연수/interviewer-avatar decisions.md: 보간 열림 50ms · 닫힘 120ms, 상한 0.55)
// · 사용자 결정(2026-10-27: 발음 시각으로 모음별 입 모양을 바꾸고, 소리가 도착하는 지연만큼 150ms 늦춘다.
//   ㅏㅑㅘ A · ㅣㅟㅢ I · ㅜㅠㅡ U · ㅔㅐㅖㅒㅚㅙㅞ E · ㅗㅛㅝㅓㅕ O, 숫자 · 영어는 A를 약하게, 공백 · 문장 부호는 닫음)

/** 메시지를 받은 뒤 입을 움직이기 시작할 때까지(ms). 에이전트는 메시지를 보낸 뒤 음성을 틀고, 소리는 그만큼 늦게 도착한다(임시 값) */
export const LIP_SYNC_DELAY_MS = 150;
/** 입을 여는 데 걸리는 시간(ms) */
export const MOUTH_OPEN_MS = 50;
/** 입을 닫는 데 걸리는 시간(ms) */
export const MOUTH_CLOSE_MS = 120;
/** 모음 입 모양의 최대 세기 */
export const MOUTH_MAX = 0.55;
/** 한글이 아닌 글자(숫자 · 영어)는 모음을 몰라 A를 이만큼만 연다 */
const OTHER_WEIGHT = 0.3;

const HANGUL_START = 0xac00;
const HANGUL_COUNT = 11172;
// 중성 21개(ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ) 순서의 입 모양
const JUNGSEONG_VOWEL: readonly Vowel[] = [
  "A", "E", "A", "E", "O", "E", "O", "E", "O", "A", "E",
  "E", "O", "U", "O", "E", "I", "U", "U", "I", "I",
]; // prettier-ignore

export interface MouthCue {
  vowel: Vowel;
  weight: number;
  startMs: number;
  endMs: number;
}

/** 글자 하나의 입 모양. 공백 · 문장 부호 · 낱자 자음처럼 소리가 없거나 모르는 글자면 null */
export function mouthOf(char: string): { vowel: Vowel; weight: number } | null {
  const code = char.codePointAt(0);
  if (code === undefined) return null;
  const syllable = code - HANGUL_START;
  if (syllable >= 0 && syllable < HANGUL_COUNT) {
    return { vowel: JUNGSEONG_VOWEL[Math.floor((syllable % 588) / 28)], weight: MOUTH_MAX };
  }
  if (/^[0-9A-Za-z]$/.test(char)) return { vowel: "A", weight: OTHER_WEIGHT };
  return null;
}

/** 발음 시각표. 입 모양이 없는 글자는 뺀다 */
export function mouthCues(
  chars: readonly { char: string; startMs: number; endMs: number }[],
): MouthCue[] {
  return chars.flatMap(({ char, startMs, endMs }) => {
    const mouth = mouthOf(char);
    return mouth ? [{ ...mouth, startMs, endMs: Math.max(startMs, endMs) }] : [];
  });
}

/** 입 모양이 모두 끝나는 시각(ms). 마지막 글자가 끝나고 입을 다 닫은 때 */
export function mouthEndMs(cues: readonly MouthCue[]): number {
  return cues.reduce((end, cue) => Math.max(end, cue.endMs + MOUTH_CLOSE_MS), 0);
}

/** 음성 시작부터 at(ms)일 때의 모음별 세기. 글자가 시작하면 MOUTH_OPEN_MS 동안 열고, 끝나면 MOUTH_CLOSE_MS 동안 닫는다 */
export function mouthAt(cues: readonly MouthCue[], at: number): Record<Vowel, number> {
  const mouth = { ...NEUTRAL_FACE.mouth };
  for (const cue of cues) {
    if (at < cue.startMs || at >= cue.endMs + MOUTH_CLOSE_MS) continue;
    const opening = Math.min(1, (at - cue.startMs) / MOUTH_OPEN_MS);
    const closing = at <= cue.endMs ? 1 : 1 - (at - cue.endMs) / MOUTH_CLOSE_MS;
    mouth[cue.vowel] = Math.max(mouth[cue.vowel], cue.weight * Math.min(opening, closing));
  }
  return mouth;
}
