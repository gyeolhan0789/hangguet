import { describe, expect, it } from "vitest";

import { buildStreamInputMessages, buildStreamInputUrl } from "./stream-input";

// 기준: API 명세 5.12(sync_alignment=true) · ElevenLabs stream-input 공식 API 문서(쿼리 · 전송하는 메시지 순서 · 글 끝 공백 한 칸)

describe("buildStreamInputUrl", () => {
  const url = new URL(
    buildStreamInputUrl({ token: "sutkn_abc", voiceId: "voice-1", modelId: "eleven_flash_v2_5" }),
  );

  it("5.12의 voiceId로 stream-input 주소를 만든다", () => {
    expect(`${url.origin}${url.pathname}`).toBe(
      "wss://api.elevenlabs.io/v1/text-to-speech/voice-1/stream-input",
    );
  });

  it("1회용 토큰 · 모델을 쿼리로 전송하고, 글자별 발음 시각을 활성화하고(sync_alignment=true) auto_mode는 비활성화한다", () => {
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: "eleven_flash_v2_5",
      single_use_token: "sutkn_abc",
      sync_alignment: "true",
      auto_mode: "false",
    });
  });

  it("output_format은 지정하지 않아 기본 MP3를 수신한다", () => {
    expect(url.searchParams.has("output_format")).toBe(false);
  });

  it("주소에 들어갈 수 없는 글자는 인코딩한다", () => {
    const encoded = new URL(buildStreamInputUrl({ token: "a&b=c", voiceId: "v/1", modelId: "m" }));
    expect(encoded.pathname).toBe("/v1/text-to-speech/v%2F1/stream-input");
    expect(encoded.searchParams.get("single_use_token")).toBe("a&b=c");
  });
});

describe("buildStreamInputMessages", () => {
  it("공백 한 칸 → 질문 글 + 끝 공백(flush) → 빈 글 순서로 전송한다", () => {
    expect(buildStreamInputMessages("자기소개를 해 주세요.")).toEqual([
      { text: " " },
      { text: "자기소개를 해 주세요. ", flush: true },
      { text: "" },
    ]);
  });

  it("질문 글 끝에 공백이 있어도 끝 공백은 한 칸이다", () => {
    expect(buildStreamInputMessages("질문입니다.  \n")[1]).toEqual({
      text: "질문입니다. ",
      flush: true,
    });
  });
});
