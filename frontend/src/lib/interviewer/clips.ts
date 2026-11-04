import {
  AnimationClip,
  LoopOnce,
  MathUtils,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  type AnimationAction,
  type AnimationMixer,
  type KeyframeTrack,
  type Object3D,
} from "three";

// 동작 클립을 이름으로 골라 재생하는 면접관(오리)의 동작. 기준: 오리 모델 안내(public/interview/duck/README.md · manifest.json:
// 클립을 하나로 합치지 말고 이름으로 골라 재생 — idle Duck_Folded_Idle · nod Duck_Nod_Double · talk Duck_Talk)
// · 사용자 결정(2026-11-04: 대기는 idle 반복, 질문 음성이 나오는 동안 talk 반복, 끄덕임 반응 · 듣는 중 끄덕임은 nod 한 번,
//   답변을 내면 감탄 소리와 함께 surprise 한 번) · three.js AnimationAction.crossFadeFrom · AnimationMixer 'finished' 이벤트

/** 이름으로 골라 재생하는 동작 클립 이름 */
export interface ClipMotions {
  /** 기본 자세(반복) */
  idle: string;
  /** 끄덕임(한 번) */
  nod: string;
  /** 말하기(반복) */
  talk: string;
  /** 놀람(한 번). 답변을 내면 감탄 소리와 함께 한다 */
  surprise: string;
  /**
   * 머리를 늘 이만큼 들어 둔다. 위에서 내려다보는 카메라를 올려다보게 한다(사용자 결정 2026-11-04).
   * 클립이 정한 머리 회전 위에 더하므로 끄덕임 · 말하기 · 놀람도 고개를 든 채로 한다.
   */
  headLift?: { node: string; degrees: number };
  /**
   * 놀람에서 부위별로 움직임을 줄이는 비율(0~1, 이름이 이것으로 시작하는 부위). 1이면 그대로, 0.5면 절반만 움직인다.
   * 사용자 요청(2026-11-04: 놀랄 때 날개를 덜 펴고 고개를 덜 돌리고 덜 올리기)
   */
  surpriseScale?: Record<string, number>;
}

/**
 * 클립의 회전 움직임을 부위별로 줄인 새 클립을 만든다. 각 키프레임 회전을 그 트랙의 첫 키프레임(시작 자세)에서
 * 비율만큼만 가게 한다(구면 보간). 비율이 없는 부위 · 회전이 아닌 트랙은 그대로 둔다.
 */
export function scaleClip(clip: AnimationClip, scale: Record<string, number> = {}): AnimationClip {
  const prefixes = Object.entries(scale);
  if (prefixes.length === 0) return clip;
  const start = new Quaternion();
  const key = new Quaternion();
  const tracks = clip.tracks.map((track): KeyframeTrack => {
    const node = track.name.split(".")[0];
    const ratio = prefixes.find(([prefix]) => node.startsWith(prefix))?.[1];
    if (ratio === undefined || !(track instanceof QuaternionKeyframeTrack)) return track;
    const values = Float32Array.from(track.values);
    start.fromArray(values, 0);
    for (let i = 0; i < values.length; i += 4) {
      key.fromArray(values, i);
      start.clone().slerp(key, ratio).toArray(values, i);
    }
    return new QuaternionKeyframeTrack(
      track.name,
      Array.from(track.times),
      Array.from(values),
      // 보간 방식(LINEAR · STEP)은 원래 트랙 그대로 둔다
      track.getInterpolation(),
    );
  });
  return new AnimationClip(clip.name, clip.duration, tracks);
}

/** 동작을 바꿀 때 앞 동작과 겹쳐 넘기는 시간(초) */
export const CLIP_FADE_SECONDS = 0.25;

export interface ClipPlayer {
  /** 말하는 동안 말하기 동작을 반복하고, 끝나면 기본 자세로 돌아간다 */
  setTalking: (talking: boolean) => void;
  /** 끄덕임을 한 번 한다. 말하는 중이거나 다른 한 번 동작 중이면 하지 않는다 */
  nod: () => void;
  /** 놀람을 한 번 한다. 끄덕이는 중이어도 바꿔서 하고, 끝나면 말하는 중이면 말하기로, 아니면 기본 자세로 돌아간다 */
  surprise: () => void;
  /** 움직이는 동작(말하기 · 한 번 동작 · 겹쳐 넘기는 중)이 있어 매 프레임 그려야 하는지 */
  readonly active: boolean;
  dispose: () => void;
}

/**
 * 믹서를 움직이면서 클립이 정한 머리 회전 위에 고개를 든 만큼 더한다(머리 축은 목에 있어 X축 회전이 고개 들기 · 숙이기다).
 * 믹서는 겹쳐 넘기기를 시작하거나 한 번 동작이 끝난 프레임처럼 머리 회전을 새로 쓰지 않는 때가 있다. 그때 다시 더하면
 * 고개가 계속 젖혀지므로(28도 → 56도 → 112도 …), 움직이기 전에 앞서 더한 만큼을 빼고 움직인 뒤 다시 더한다.
 * 반환한 함수에 믹서를 움직이는 일(update)을 넘긴다. 더 할 것이 없으면 그 일만 한다.
 */
export function createHeadLift(
  root: Object3D,
  lift: ClipMotions["headLift"],
): (update: () => void) => void {
  if (!lift) return (update) => update();
  const head = root.getObjectByName(lift.node);
  if (!head) throw new Error(`면접관 머리 ${lift.node}가 모델에 없다`);
  // 앞(+Z)을 보는 모델에서 +X축 회전은 고개를 숙이므로 반대로 돌려 든다
  const offset = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    -MathUtils.degToRad(lift.degrees),
  );
  const undo = offset.clone().invert();
  let lifted = false;
  return (update) => {
    if (lifted) head.quaternion.multiply(undo);
    update();
    head.quaternion.multiply(offset);
    lifted = true;
  };
}

/** 믹서에 동작 클립을 걸고 기본 자세로 둔다. 필요한 클립이 모델에 없으면 오류를 던진다(장면은 정지 이미지로 바꾼다). */
export function createClipPlayer(
  mixer: AnimationMixer,
  animations: readonly AnimationClip[],
  motions: ClipMotions,
): ClipPlayer {
  const find = (name: string) => {
    const clip = AnimationClip.findByName([...animations], name);
    if (!clip) throw new Error(`면접관 동작 ${name}이 모델에 없다`);
    return clip;
  };
  const action = (name: string) => mixer.clipAction(find(name));
  const idle = action(motions.idle);
  const talk = action(motions.talk);
  const nod = action(motions.nod);
  const surprise = mixer.clipAction(scaleClip(find(motions.surprise), motions.surpriseScale));
  nod.setLoop(LoopOnce, 1);
  surprise.setLoop(LoopOnce, 1);

  let talking = false;
  /** 지금 하는 한 번 동작(끄덕임 · 놀람). 없으면 null */
  let once: AnimationAction | null = null;
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
    if (event.action !== once) return;
    once = null;
    fadeTo(base());
  };
  mixer.addEventListener("finished", finished);

  return {
    setTalking(next) {
      talking = next;
      if (!once) fadeTo(base());
    },
    nod() {
      if (once || talking) return;
      once = nod;
      fadeTo(nod);
    },
    surprise() {
      if (once === surprise) return;
      once = surprise;
      fadeTo(surprise);
    },
    get active() {
      return talking || once !== null || mixer.time < fadeEnd;
    },
    dispose() {
      mixer.removeEventListener("finished", finished);
    },
  };
}
