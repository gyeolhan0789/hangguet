// 화면과 서버 액션이 같이 쓰는 안내 문구. axios 등 서버 전용 모듈을 불러오지 않아 클라이언트 컴포넌트도 쓸 수 있다.

/** 서버에 닿지 못했거나 응답 형식을 모를 때 보여 줄 문구(mock 500 INTERNAL_ERROR detail과 같다) */
export const RETRY_LATER = "잠시 후 다시 시도해 주세요.";

/**
 * 질문 음성(5.12 · ElevenLabs 연결 · 재생)이 실패해 질문 글로 진행할 때 보여 줄 문구(BE 503 TTS_UNAVAILABLE detail과 같다,
 * ErrorCode.java:33). 본문 없는 502 · 504와 WebSocket 실패에는 서버 문구가 없으므로 FE가 정의한다. 최종 문구는 화면 담당이 확정한다.
 */
export const QUESTION_VOICE_FAILED = "질문 음성을 불러오지 못했어요. 글로 보여 드릴게요.";
