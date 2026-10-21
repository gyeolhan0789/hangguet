import type { TtsTokenResponse } from "@/types/api";

// 기준: Swagger 5.12 질문 음성 토큰(TtsTokenResponse: token · voiceId · modelId) · API 명세 5.12(수신한 voiceId · modelId로 연결해
// 질문 글을 전송한다, 글자별 발음 시각은 sync_alignment=true를 지정해야 수신된다) · ElevenLabs stream-input(WebSocket) 공식 API 문서
// 브라우저 WebSocket은 헤더를 지정할 수 없으므로 1회용 토큰을 쿼리(single_use_token)로 전송한다.

const STREAM_INPUT_BASE = "wss://api.elevenlabs.io/v1/text-to-speech";

/** 연결에 사용하는 5.12 응답 값 */
export type StreamInputTarget = Pick<TtsTokenResponse, "token" | "voiceId" | "modelId">;

/**
 * ElevenLabs stream-input 연결 주소를 만든다.
 * - sync_alignment=true: 기본값이 false이므로 반드시 지정한다(API 명세 5.12).
 * - auto_mode=false: 글 전체를 한 번에 전송하고 flush로 생성을 시작한다. 기본값도 false지만 정한 값을 드러내기 위해 명시한다.
 * - output_format은 지정하지 않아 기본 MP3를 수신한다. 공식 문서에 허용값 목록이 없다.
 *   로컬 실측(2026-10-21)에서 기본 MP3는 128kbps 고정 비트레이트였고 소리가 끝 응답과 함께 한꺼번에 도착하므로 PCM으로 변경하지 않는다.
 */
export function buildStreamInputUrl({ token, voiceId, modelId }: StreamInputTarget): string {
  const query = new URLSearchParams({
    model_id: modelId,
    single_use_token: token,
    sync_alignment: "true",
    auto_mode: "false",
  });
  return `${STREAM_INPUT_BASE}/${encodeURIComponent(voiceId)}/stream-input?${query.toString()}`;
}

/** stream-input으로 전송하는 메시지 */
export type StreamInputMessage = { text: string; flush?: true };

/**
 * 질문 글 하나를 읽게 할 때 전송하는 메시지를 순서대로 만든다.
 * 1. 연결 시작: 공백 한 칸(공식 문서: 처음 전송하는 글은 공백이어야 한다)
 * 2. 질문 글 + 끝 공백 한 칸, flush(공식 문서: 글은 공백 한 칸으로 끝나야 한다. 짧은 글은 flush해야 바로 생성한다)
 * 3. 빈 글: 더 전송할 글이 없다(연결 종료)
 */
export function buildStreamInputMessages(content: string): StreamInputMessage[] {
  return [{ text: " " }, { text: `${content.trimEnd()} `, flush: true }, { text: "" }];
}
