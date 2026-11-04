import { AnimationClip, LoopOnce, type AnimationAction, type AnimationMixer } from "three";

// 동작 클립을 이름으로 골라 재생하는 면접관(오리)의 동작. 기준: 오리 모델 안내(public/interview/duck/README.md · manifest.json:
// 클립을 하나로 합치지 말고 이름으로 골라 재생 — idle Duck_Folded_Idle · nod Duck_Nod_Double · talk Duck_Talk)
// · 사용자 결정(2026-11-04: 대기는 idle 반복, 질문 음성이 나오는 동안 talk 반복, 끄덕임 반응 · 듣는 중 끄덕임은 nod 한 번,
//   놀람(Duck_Surprise)은 쓰지 않는다) · three.js AnimationAction.crossFadeFrom · AnimationMixer 'finished' 이벤트

/** 이름으로 골라 재생하는 동작 클립 이름 */
export interface ClipMotions {
  /** 기본 자세(반복) */
  idle: string;
  /** 끄덕임(한 번) */
  nod: string;
  /** 말하기(반복) */
  talk: string;
}

/** 동작을 바꿀 때 앞 동작과 겹쳐 넘기는 시간(초) */
export const CLIP_FADE_SECONDS = 0.25;

export interface ClipPlayer {
  /** 말하는 동안 말하기 동작을 반복하고, 끝나면 기본 자세로 돌아간다 */
  setTalking: (talking: boolean) => void;
  /** 끄덕임을 한 번 한다. 말하는 중이거나 이미 끄덕이는 중이면 하지 않는다 */
  nod: () => void;
  /** 움직이는 동작(말하기 · 끄덕임 · 겹쳐 넘기는 중)이 있어 매 프레임 그려야 하는지 */
  readonly active: boolean;
  dispose: () => void;
}

/** 믹서에 동작 클립을 걸고 기본 자세로 둔다. 필요한 클립이 모델에 없으면 오류를 던진다(장면은 정지 이미지로 바꾼다). */
export function createClipPlayer(
  mixer: AnimationMixer,
  animations: readonly AnimationClip[],
  motions: ClipMotions,
): ClipPlayer {
  const action = (name: string) => {
    const clip = AnimationClip.findByName([...animations], name);
    if (!clip) throw new Error(`면접관 동작 ${name}이 모델에 없다`);
    return mixer.clipAction(clip);
  };
  const idle = action(motions.idle);
  const talk = action(motions.talk);
  const nod = action(motions.nod);
  nod.setLoop(LoopOnce, 1);

  let talking = false;
  let nodding = false;
  let current: AnimationAction = idle;
  /** 겹쳐 넘기기가 끝나는 믹서 시각(초) */
  let fadeEnd = 0;
  idle.play();

  const fadeTo = (next: AnimationAction) => {
    if (next === current) return;
    next.reset().play();
    next.crossFadeFrom(current, CLIP_FADE_SECONDS, false);
    current = next;
    fadeEnd = mixer.time + CLIP_FADE_SECONDS;
  };
  const base = () => (talking ? talk : idle);
  const finished = (event: { action: AnimationAction }) => {
    if (event.action !== nod) return;
    nodding = false;
    fadeTo(base());
  };
  mixer.addEventListener("finished", finished);

  return {
    setTalking(next) {
      talking = next;
      if (!nodding) fadeTo(base());
    },
    nod() {
      if (nodding || talking) return;
      nodding = true;
      fadeTo(nod);
    },
    get active() {
      return talking || nodding || mixer.time < fadeEnd;
    },
    dispose() {
      mixer.removeEventListener("finished", finished);
    },
  };
}
