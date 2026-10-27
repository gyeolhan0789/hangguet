package com.ssafy.a301.interview.domain;

/** 녹화 파일 상태. MERGING 합치는 중 · READY 파일 있음 · FAILED 합치기 실패(recording.mergeFailed) */
public enum RecordingStatus {
    MERGING,
    READY,
    FAILED
}
