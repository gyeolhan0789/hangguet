package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "파일 종류. SESSION_VIDEO 면접 녹화 영상 · ANSWER_AUDIO 답변 음성")
public enum RecordingType {
    SESSION_VIDEO,
    ANSWER_AUDIO
}
