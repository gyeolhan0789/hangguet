import { z } from "zod";

// 기준: 사용자 승인 STT 표시 계약 · ai/app/agent/transcript.py · LiveKit text streams.
// HTTP API 응답이 아닌, 같은 면접방의 에이전트가 보내는 텍스트 스냅샷이다.
export const STT_TOPIC = "interview.stt";

export const transcriptSchema = z.object({
  streamId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  confirmedText: z.string(),
  interimText: z.string(),
  state: z.enum(["listening", "failed"]),
});

export type TranscriptSnapshot = z.infer<typeof transcriptSchema>;
