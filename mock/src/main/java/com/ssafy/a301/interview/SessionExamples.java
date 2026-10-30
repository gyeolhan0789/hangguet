package com.ssafy.a301.interview;

/**
 * 연습 면접 목록 고정 예시. 5.13 · 5.15(날짜별)와 4.6(지원서별)이 같은 면접을 보여 준다. 시작 시각 내림차순이다. 55 · 52는 ○○전자 지원서(12),
 * 54 · 53은 △△소프트 지원서(9)로 본 면접이다.
 */
public final class SessionExamples {

    private SessionExamples() {}

    public static final String ITEMS =
            """
            [
              { "id": 55, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
                "persona": "DEVIL", "mode": "VIDEO", "status": "COMPLETED",
                "startedAt": "2026-10-21T23:50:00+09:00", "endedAt": "2026-10-22T00:10:00+09:00",
                "answeredCount": 5, "summary": "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
                "criterionGrades": [
                  { "criterion": "JOB_FIT", "grade": "GOOD" },
                  { "criterion": "COVER_LETTER", "grade": "WEAK" },
                  { "criterion": "LOGIC", "grade": "GOOD" },
                  { "criterion": "DELIVERY", "grade": "NORMAL" } ] },
              { "id": 54, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                "persona": "COFFEE_CHAT", "mode": "CHAT", "status": "ANALYZING",
                "startedAt": "2026-10-21T19:30:00+09:00", "endedAt": "2026-10-21T19:42:00+09:00",
                "answeredCount": 3, "summary": null, "criterionGrades": [] },
              { "id": 53, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                "persona": "COFFEE_CHAT", "mode": "VIDEO", "status": "FAILED",
                "startedAt": "2026-10-20T21:00:00+09:00", "endedAt": "2026-10-20T21:22:00+09:00",
                "answeredCount": 5, "summary": null, "criterionGrades": [] },
              { "id": 52, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
                "persona": "DEVIL", "mode": "CHAT", "status": "COMPLETED",
                "startedAt": "2026-10-20T20:00:00+09:00", "endedAt": "2026-10-20T20:10:00+09:00",
                "answeredCount": 2, "summary": null,
                "criterionGrades": [
                  { "criterion": "JOB_FIT", "grade": "NORMAL" },
                  { "criterion": "COVER_LETTER", "grade": "NORMAL" },
                  { "criterion": "LOGIC", "grade": "GOOD" },
                  { "criterion": "DELIVERY", "grade": "NORMAL" } ] }
            ]
            """;
}
