// 6. 녹화 · 결과 · 다시보기 요청. 기준: 웹 Swagger 6.1 · 6.2.
// 경로 값은 면접 진행과 같다(../interview/request의 SessionPath).

/** 파일 종류. SESSION_VIDEO 면접 녹화 영상 */
export type RecordingType = "SESSION_VIDEO";

/** 녹화 영상 형식 */
export type RecordingContentType = "video/webm" | "video/mp4";

/** 6.1 POST /interview-sessions/{sessionId}/recordings/upload-url 본문 */
export interface RecordingUploadUrlRequest {
  /** 영상 형식. 필수 */
  contentType: RecordingContentType;
}

/** 6.2 POST /interview-sessions/{sessionId}/recordings 본문 */
export interface RecordingCreateRequest {
  /** 파일 종류. 필수 */
  recordingType: RecordingType;
  /** 6.1에서 받은 objectKey. 필수 */
  objectKey: string;
}

// 6.3 면접 결과 · 6.4 다시보기는 요청 값이 없다.
