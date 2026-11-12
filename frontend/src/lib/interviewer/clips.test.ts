// @vitest-environment node
// 기준: 오리 모델 안내(public/interview/duck/README.md · manifest.json: 클립을 이름으로 골라 재생)
// · 사용자 결정(2026-11-04: 대기 idle 반복 · 질문 음성 중 talk 반복 · 끄덕임 nod 한 번 · 답변 뒤 surprise 한 번 · 고개 들어 두기)
// · 사용자 요청(2026-11-04: 놀랄 때 날개를 덜 펴고 고개를 덜 돌리고 덜 올리기)
import {
  AnimationClip,
  AnimationMixer,
  Euler,
  Group,
  InterpolateDiscrete,
  MathUtils,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";

import { createClipPlayer, createHeadLift, scaleClip } from "./clips";

// 예시 데이터: 오리 모델과 같은 이름의 동작 클립(반복 1초 · 한 번 0.5초)
const MOTIONS = {
  idle: "Duck_Idle",
  nod: "Duck_Nod",
  talk: "Duck_Talk",
  surprise: "Duck_Surprise",
};

function motionClip(name: string, seconds: number) {
  return new AnimationClip(name, seconds, [
    new VectorKeyframeTrack("Duck.position", [0, seconds], [0, 0, 0, 0, 1, 0]),
  ]);
}

function duck(animations = Object.values(MOTIONS)) {
  const root = new Group();
  const body = new Object3D();
  body.name = "Duck";
  root.add(body);
  const clips = animations.map((name) =>
    motionClip(name, name === MOTIONS.idle || name === MOTIONS.talk ? 1 : 0.5),
  );
  const mixer = new AnimationMixer(root);
  const player = createClipPlayer(mixer, clips, MOTIONS);
  const action = (name: string) => mixer.existingAction(clips.find((clip) => clip.name === name)!)!;
  return {
    mixer,
    player,
    idle: action(MOTIONS.idle),
    talk: action(MOTIONS.talk),
    nod: action(MOTIONS.nod),
    surprise: action(MOTIONS.surprise),
  };
}

function turn(degrees: number) {
  return new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(degrees))
    .toArray();
}

function surpriseClip() {
  return new AnimationClip("Duck_Surprise", 1, [
    new QuaternionKeyframeTrack("Duck_Wing_L_Upper.quaternion", [0, 1], [...turn(10), ...turn(90)]),
    new QuaternionKeyframeTrack(
      "Duck_Head.quaternion",
      [0, 1],
      [...turn(0), ...turn(40)],
      InterpolateDiscrete,
    ),
    new QuaternionKeyframeTrack("Duck_Tail.quaternion", [0, 1], [...turn(0), ...turn(60)]),
    new VectorKeyframeTrack("Duck_Wing_L_Upper.position", [0, 1], [0, 0, 0, 1, 1, 1]),
  ]);
}

function angleAt(track: KeyframeTrack, key: number) {
  return MathUtils.radToDeg(
    new Quaternion().fromArray(track.values, key * 4).angleTo(new Quaternion()),
  );
}

function headModel() {
  const root = new Group();
  const head = new Object3D();
  head.name = "Duck_Head";
  root.add(head);
  return { root, head };
}

function pitch(head: Object3D) {
  return MathUtils.radToDeg(new Euler().setFromQuaternion(head.quaternion).x);
}

describe("scaleClip · 놀람 동작 줄이기", () => {
  describe("정상 처리", () => {
    it("이름이 비율 접두로 시작하는 부위의 회전을 시작 자세에서 비율만큼만 움직이고 보간 방식은 그대로 둔다", () => {
      const [wing, head] = scaleClip(surpriseClip(), { Duck_Wing: 0.5, Duck_Head: 0.5 }).tracks;

      expect(angleAt(wing, 0)).toBeCloseTo(10, 4);
      expect(angleAt(wing, 1)).toBeCloseTo(50, 4);
      expect(angleAt(head, 1)).toBeCloseTo(20, 4);
      expect(head.getInterpolation()).toBe(InterpolateDiscrete);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "비율이 없는 부위", index: 2 },
      { label: "회전이 아닌 트랙", index: 3 },
    ])("'$label'은 그대로 둔다", ({ index }) => {
      const original = surpriseClip();

      const scaled = scaleClip(original, { Duck_Wing: 0.5, Duck_Head: 0.5 });

      expect(scaled.tracks[index]).toBe(original.tracks[index]);
    });
  });

  describe("경계값", () => {
    it("줄일 비율이 없으면 원래 클립을 그대로 쓴다", () => {
      const original = surpriseClip();

      expect(scaleClip(original)).toBe(original);
    });
  });
});

describe("createHeadLift · 고개 들어 두기", () => {
  describe("정상 처리", () => {
    it("믹서가 머리 회전을 쓴 프레임이면 그 회전 위에 든 각도를 한 번 더한다", () => {
      const { root, head } = headModel();
      const move = createHeadLift(root, { node: "Duck_Head", degrees: 28 });

      move(() => head.quaternion.setFromEuler(new Euler(MathUtils.degToRad(-10), 0, 0)));

      expect(pitch(head)).toBeCloseTo(-38, 5);
    });
  });

  describe("상태 변화", () => {
    it("믹서가 머리 회전을 쓰지 않는 프레임이 이어져도 든 각도가 쌓이지 않는다", () => {
      const { root, head } = headModel();
      const move = createHeadLift(root, { node: "Duck_Head", degrees: 28 });

      move(() => {});
      move(() => {});
      move(() => {});

      expect(pitch(head)).toBeCloseTo(-28, 5);
    });
  });

  describe("경계값", () => {
    it("들 각도가 없으면 믹서만 움직인다", () => {
      const { root, head } = headModel();
      let moved = 0;

      createHeadLift(root, undefined)(() => moved++);

      expect(moved).toBe(1);
      expect(pitch(head)).toBeCloseTo(0, 5);
    });
  });

  describe("오류 처리", () => {
    it("머리가 모델에 없으면 오류를 던진다", () => {
      expect(() => createHeadLift(new Group(), { node: "Duck_Head", degrees: 28 })).toThrow(
        "면접관 머리 Duck_Head가 모델에 없다",
      );
    });
  });
});

describe("createClipPlayer · 동작 클립 재생", () => {
  describe("정상 처리", () => {
    it("처음에는 기본 자세를 재생하고 매 프레임 그릴 필요가 없다", () => {
      const { player, idle, talk } = duck();

      expect(idle.isRunning()).toBe(true);
      expect(talk.isRunning()).toBe(false);
      expect(player.active).toBe(false);
    });
  });

  describe("상태 변화", () => {
    it("말하기를 켜면 말하기 동작으로, 끄면 기본 자세로 넘긴다", () => {
      const { mixer, player, idle, talk } = duck();

      player.setTalking(true);
      mixer.update(0.3);
      expect(talk.isRunning()).toBe(true);
      expect(idle.isRunning()).toBe(false);

      player.setTalking(false);
      mixer.update(0.3);
      expect(idle.isRunning()).toBe(true);
      expect(talk.isRunning()).toBe(false);
    });

    it("끄덕이면 끄덕임 동작으로 한 번 넘긴다", () => {
      const { mixer, player, nod } = duck();

      player.nod();
      mixer.update(0.3);
      expect(nod.isRunning()).toBe(true);

      mixer.update(0.3);
      expect(nod.isRunning()).toBe(false);
    });

    it.each([
      { label: "말하는 중이면", to: "말하기", talking: true, back: "talk" as const },
      { label: "아니면", to: "기본 자세", talking: false, back: "idle" as const },
    ])("한 번 동작이 끝나면 '$label' $to로 돌아간다", ({ talking, back }) => {
      const motion = duck();
      motion.player.setTalking(talking);
      motion.player.surprise();

      motion.mixer.update(0.6);
      motion.mixer.update(0.3);

      expect(motion[back].isRunning()).toBe(true);
      expect(motion.surprise.isRunning()).toBe(false);
    });

    it("한 번 동작 중 말하기를 바꾸면 그 동작이 끝난 뒤 반영한다", () => {
      const { mixer, player, nod, talk } = duck();
      player.nod();

      player.setTalking(true);
      mixer.update(0.3);
      expect(nod.isRunning()).toBe(true);
      expect(talk.isRunning()).toBe(false);

      mixer.update(0.3);
      expect(talk.isRunning()).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it.each([
      {
        label: "말하는 중",
        start: (player: ReturnType<typeof duck>["player"]) => player.setTalking(true),
      },
      {
        label: "다른 한 번 동작 중",
        start: (player: ReturnType<typeof duck>["player"]) => player.surprise(),
      },
    ])("'$label'이면 끄덕이지 않는다", ({ start }) => {
      const { player, nod } = duck();
      start(player);

      player.nod();

      expect(nod.isRunning()).toBe(false);
    });
  });

  describe("경계값", () => {
    it("지금과 같은 동작으로 넘기면 겹쳐 넘기지 않아 그릴 필요가 없다", () => {
      const { player } = duck();

      player.setTalking(false);

      expect(player.active).toBe(false);
    });
  });

  describe("오류 처리", () => {
    it("필요한 클립이 모델에 없으면 오류를 던진다", () => {
      expect(() => duck([MOTIONS.idle, MOTIONS.talk, MOTIONS.surprise])).toThrow(
        "면접관 동작 Duck_Nod이 모델에 없다",
      );
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("끄덕이는 중 놀람을 받으면 놀람으로 바꾼다", () => {
      const { mixer, player, nod, surprise } = duck();
      player.nod();
      mixer.update(0.1);

      player.surprise();
      mixer.update(0.3);

      expect(surprise.isRunning()).toBe(true);
      expect(nod.isRunning()).toBe(false);
    });

    it("놀라는 중 다시 놀람을 받으면 처음부터 다시 하지 않는다", () => {
      const { mixer, player, surprise } = duck();
      player.surprise();
      mixer.update(0.2);

      player.surprise();

      expect(surprise.time).toBeCloseTo(0.2);
    });
  });

  describe("시간 경과", () => {
    it("동작을 바꾼 뒤 0.25초 동안은 계속 그리고 지나면 멈춘다", () => {
      const { mixer, player } = duck();
      player.setTalking(true);
      player.setTalking(false);

      mixer.update(0.2);
      expect(player.active).toBe(true);

      mixer.update(0.1);
      expect(player.active).toBe(false);
    });
  });

  describe("정리", () => {
    it("정리한 뒤에는 한 번 동작이 끝나도 자세를 바꾸지 않는다", () => {
      const { mixer, player, idle } = duck();
      player.nod();
      mixer.update(0.3);

      player.dispose();
      mixer.update(0.6);

      expect(idle.isRunning()).toBe(false);
    });
  });
});
