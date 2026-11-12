// 기준: API 명세 면접방 메시지(오리 면접은 답변 제출이 시작되면 호응 효과음을 한 번 재생, 재생에 실패하면 효과음 없이 진행)
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushPromises } from "@/test/flush";

// 경계 mock: 브라우저 오디오(Audio). 효과음은 모듈 수준에 하나만 만들어 두므로 테스트마다 모듈을 새로 불러온다.
// play는 vi.fn으로 감싸지 않는다(vi.fn은 돌려준 Promise에 결과 기록용 처리기를 붙여, 처리되지 않은 거부를 가린다)
class FakeAudio {
  static created: FakeAudio[] = [];
  currentTime = 0;
  volume = 1;
  preload = "";
  plays = 0;
  refusal: DOMException | null = null;
  constructor(readonly src: string) {
    FakeAudio.created.push(this);
  }
  play() {
    this.plays += 1;
    return this.refusal ? Promise.reject(this.refusal) : Promise.resolve();
  }
}

async function loadDuckCall() {
  vi.resetModules();
  return import("./duck-call");
}

beforeEach(() => {
  FakeAudio.created = [];
  vi.stubGlobal("Audio", FakeAudio);
});

describe("playDuckCall · 오리 호응 효과음", () => {
  describe("정상 처리", () => {
    it("두 번 재생해도 소리를 한 번만 만들고 매번 처음부터 튼다", async () => {
      const { playDuckCall } = await loadDuckCall();
      playDuckCall();
      const [sound] = FakeAudio.created;
      sound.currentTime = 1.2;

      playDuckCall();

      expect(FakeAudio.created).toHaveLength(1);
      expect(sound.currentTime).toBe(0);
      expect(sound.plays).toBe(2);
    });
  });

  describe("오류 처리", () => {
    it("자동 재생이 막혀 재생이 거부돼도 오류를 던지지 않는다", async () => {
      const { playDuckCall } = await loadDuckCall();
      playDuckCall();
      const [sound] = FakeAudio.created;
      sound.refusal = new DOMException("play() failed", "NotAllowedError");

      // 거부된 재생이 처리되지 않은 거부로 남으면 Vitest가 실행 실패로 본다
      expect(() => playDuckCall()).not.toThrow();
      await flushPromises();
      expect(sound.plays).toBe(2);
    });
  });
});
