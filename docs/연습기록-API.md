# 연습 기록 화면 API

승인된 연습 기록 화면의 달력, 면접 카드, 상세 화면 이동에 필요한 **백엔드 API 계약**을 정리한다. 프론트 연결 현황은 5장에 적는다. 배포 완료 여부를 뜻하지 않는다.

요청·응답의 정식 계약은 [API 명세](API-명세.md)와 [목 서버 Swagger](https://hangguet.yobistory.com/mock/be/docs)를 따른다. 이 문서는 화면에서 어떤 API와 필드를 사용하는지 설명한다.

## 1. 필요한 API

모든 경로 앞에 `/api/v1`이 붙고, 로그인한 본인의 데이터만 조회한다.

| 번호 | API | 호출 시점 | 용도 |
| --- | --- | --- | --- |
| 5.15 | `GET /interview-sessions/calendar?month=YYYY-MM` | 첫 진입, 월 이동 | 월 전체의 날짜별 면접 횟수(0회 포함) |
| 5.13 | `GET /interview-sessions?practiceDate=YYYY-MM-DD&page=0&size=5` | 첫 진입, 날짜·월·페이지 이동 | 선택 시작 날짜의 면접 카드와 집계 표시 |
| 6.3 | `GET /interview-sessions/{sessionId}/result` | 상세 피드백 화면 진입 | 면접 1회의 상세 평가 |
| 6.4 | `GET /interview-sessions/{sessionId}/replay` | 다시보기 화면 진입 | 녹화 영상 또는 채팅 기록 |
| 7.1 | `GET /growth-reviews/{practiceDate}` | 날짜별 성장 리뷰 화면 진입 | 그날 전체 면접의 성장 리뷰 |

연습 기록 전용 API는 **5.13 연습 면접 목록**과 **5.15 월별 연습 면접 횟수**다. 상세·다시보기·성장 리뷰는 기존 계약을 재사용한다. 승인된 화면에는 통계 타일이 없으므로 3.2 통계와 7.2 최근 성장 리뷰 목록은 연결 대상에서 제외한다. 아래 화면 주소와 표시 방법은 향후 프론트 연결 기준이다.

## 2. 화면과 응답 필드

### 달력 — 5.15

```http
GET /api/v1/interview-sessions/calendar?month=2026-10
```

`month`는 필수이며 `YYYY-MM` 형식(0001-01~9999-12)이다. 본인의 면접을 한국 시간 시작일로 집계한다. 일별 목록과 동일하게 답변 1개 이상인 `ANALYZING`·`COMPLETED`·`FAILED`만 포함한다.

```json
{
  "month": "2026-10",
  "content": [
    { "practiceDate": "2026-10-01", "interviewCount": 0 },
    { "practiceDate": "2026-10-02", "interviewCount": 0 }
  ]
}
```

위 예시는 앞의 두 날짜만 발췌했다. 실제 응답은 월 1일부터 말일까지 모든 날짜(28~31개)를 오름차순으로 포함한다. 기록이 없는 날짜도 0회로 내려주며 페이지를 나누지 않는다.

- `content[].practiceDate`: 달력 날짜.
- `content[].interviewCount`: 해당 시작 날짜의 면접 횟수. 같은 날짜 5.13의 `page.totalElements`와 같다.
- 면접 한 건에 답변이 여러 개여도 1회로 센다. 다음 날·다음 달에 종료해도 시작 날짜에 포함한다.
- 달력 표시점·횟수는 월별 API 한 번으로 표시한다. 날짜별 목록을 28~31번 호출하지 않는다.
- 기존 3.3은 마이페이지 스트릭 달력용 계약으로 유지한다.

### 면접 카드와 집계 — 5.13

```http
GET /api/v1/interview-sessions?practiceDate=2026-10-21&page=0&size=5
```

| 쿼리 | 필수 | 기본값 | 규칙 |
| --- | --- | --- | --- |
| `practiceDate` | 필수 | 없음 | 한국 시간의 면접 시작 날짜, `YYYY-MM-DD` |
| `page` | 선택 | `0` | 0부터 시작하는 정수 페이지 |
| `size` | 선택 | `5` | 1~20. 화면 연결 시 페이지당 5개 조회 권장 |

응답은 기존 페이지 목록의 `content`, `page`에 집계용 `summary`를 추가한 구조다.

| 화면 요소 | 응답 필드 | 표시 방법 |
| --- | --- | --- |
| 상단 보관함 전체 건수 | `summary.totalInterviewCount` | 날짜 필터 없이 본인의 전체 연습 면접 수 |
| 선택 날짜의 면접 수 | `page.totalElements` | 선택 날짜 전체 건수. 현재 페이지 항목 수가 아님 |
| 선택 날짜의 연습 시간 | `summary.practiceMinutes` | 선택 날짜 전체 연습 시간 |
| 회사·직무 | `content[].companyName`, `jobTitle` | 카드 제목 |
| 면접 방식 | `content[].mode` | `VIDEO` → 화상, `CHAT` → 채팅 |
| 면접관 | `content[].persona` | 면접관 표시 이름 |
| 시작 시각·소요 시간 | `content[].startedAt`, `endedAt` | 한국 시간 시작 시각, 두 시각의 차이를 분으로 표시 |
| 답변 수 | `content[].answeredCount` | 제출한 답변 수 |
| 분석 상태 | `content[].status` | 분석 중·완료·실패 |
| 간단 평가 | `content[].criterionGrades[]` | 기준(`criterion`)별 등급(`grade`) |
| 한 줄 총평 | `content[].summary` | 기존 6.3의 `summary`와 같은 값 |
| 상세 화면 식별자 | `content[].id` | 상세 피드백·다시보기의 `sessionId` |
| 페이지 이동 | `page.number`, `size`, `totalPages` | 같은 날짜의 이전·다음 페이지 |

최상위 `summary`는 **집계 객체**, `content[].summary`는 **면접 한 줄 총평**이다.

평가 기준은 `JOB_FIT`(직무 적합성), `COVER_LETTER`(자소서 검증), `LOGIC`(논리성), `DELIVERY`(전달력)다. 등급은 `GOOD`(좋아요), `NORMAL`(보통), `WEAK`(아쉬워요)로 표시한다.

| 상태 | 카드 평가·총평 | 상세 피드백·다시보기 버튼 |
| --- | --- | --- |
| `COMPLETED` | 기준별 등급 4개. 총평은 값이 있을 때 표시 | 표시 |
| `ANALYZING` | 등급 빈 배열·총평 null. 분석 중 안내 | 숨김 |
| `FAILED` | 등급 빈 배열·총평 null. 분석 실패 안내 | 숨김 |

- 답변 1개 이상인 위 3개 상태만 목록·집계에 포함한다. `READY`, `IN_PROGRESS`, `ABORTED`는 제외한다.
- 시작 시각 내림차순이며 같은 시각이면 `id` 내림차순이다.
- 자정 전 시작해 다음 날 종료하면 **시작한 날짜**에 들어간다. 예를 들어 21일 23:50~22일 00:10 면접은 21일 기록이며 시간은 전체 20분이다.
- 날짜별 시간은 전체 세션의 `(endedAt − startedAt)` 초 합을 60으로 나눠 내림한다. 카드별로 내림한 분의 합과는 다를 수 있다. 연결 중 멈춘 시간도 포함한다.
- 페이지를 바꿔도 보관함 건수·선택 날짜 건수·날짜별 시간은 유지된다.
- 완료된 면접도 총평이 없으면 null이다. 문장을 프론트에서 생성하거나 기본 문구로 대체하지 않는다.
- 상세 답변·말하기 지표·영상 주소는 목록에 포함하지 않는다. 카드마다 6.3을 추가 호출하지 않는다.

### 상세 화면 연결 — 6.3, 6.4, 7.1

| 버튼 | 화면 주소 | 해당 화면이 조회할 API·주요 데이터 |
| --- | --- | --- |
| 상세 피드백 | `/interview/{id}/result` | 6.3: `summary`, `sessionScores`, `answers`, `speechMetrics` |
| 다시보기 | `/interview/{id}/replay` | 6.4: `mode`, `videoUrl`, 질문·답변 목록 `items` |
| 날짜별 성장 리뷰 | `/reviews/{practiceDate}` | 7.1: 날짜별 횟수·시간, `criteria`, `nextActions`, 비교 날짜 |

마이페이지 달력·스트릭·홈 통계·성장 리뷰도 모두 **한국 시간 시작일 기준**이다. 자정을 넘겨도 같은 시작 날짜에 속한다. 성장 리뷰는 완료 결과가 필요하므로 해당 시작 날짜에 분석 중·실패 면접만 있으면 리뷰가 없을 수 있다.

## 3. 프론트 연결 시 호출 흐름

1. `/records`에 들어오면 한국 시간 오늘을 선택한다. 달력(5.15)과 그날 목록(5.13)을 조회한다.
2. 날짜를 선택하면 주소의 `practiceDate`를 바꾸고 `page`를 0으로 초기화한다. 월 이동은 해당 월의 선택 날짜를 계산해 같은 흐름으로 조회한다. 미래 날짜는 선택하지 않는다.
3. 월이 바뀌면 달력과 목록을 조회하고, 같은 월의 날짜·페이지 이동은 목록을 갱신한다. 캐시·재조회 구현은 프론트 연결 단계에서 정한다.
4. 상세 버튼은 위 표의 주소로 이동한다. 해당 상세 화면에서 필요한 API를 조회하는 구조다.

API 계약은 자동 폴링을 요구하지 않는다. 상태 갱신 주기와 화면 구현은 프론트 작업에서 정한다. 인증 토큰과 서버 호출 방식은 프로젝트 공통 규칙을 따른다.

## 4. 빈 상태와 오류

| 상황 | API 응답·처리 |
| --- | --- |
| 기록 없는 월 | 5.15는 200·월의 모든 날짜·각 날짜 횟수 0 |
| 기록 없는 날짜 | 5.13은 200·빈 목록·날짜 건수/시간 0. 전체 보관함 건수는 유지 |
| 범위를 넘는 페이지 | 5.13은 200·빈 목록·실제 집계. 화면은 빈 날짜와 구분하고 첫 페이지 복귀 링크 제공 |
| 잘못된 월·날짜·페이지·크기 | 400 `VALIDATION_FAILED` |
| 완료 결과에 기준별 평가가 누락 | 실제 BE는 500 `INTERNAL_ERROR`. 불완전한 평가를 정상 응답하지 않음 |
| 목록·달력 조회 실패 | 공통 오류 응답. 화면의 오류 안내·재시도 처리는 프론트 연결 범위 |
| 상세 결과 미완료 | 6.3·6.4는 409 `RESULT_NOT_READY`. 답변 없이 종료한 세션은 `NO_RESULT` |
| 날짜의 성장 리뷰 없음 | 7.1은 404 `GROWTH_REVIEW_NOT_FOUND`. 연습 기록 자체가 없다는 의미로 단정하지 않음 |
| 다시보기 영상 없음 | 6.4의 `videoUrl`이 null일 수 있음. 채팅은 대화 기록으로 제공 |

인증 오류와 공통 오류 형식은 [API 명세의 공통 규약](API-명세.md#1-공통-규약)을 따른다.

## 5. 현재 구현 상태

| API·화면 | 목 서버 | 실제 BE | 프론트 |
| --- | --- | --- | --- |
| 5.15 월별 횟수 달력 | 구현 | 구현 | 연결(`/records`) |
| 5.13 면접 목록 | 구현 | 구현 | 연결(`/records`) |
| 6.3 상세 피드백 | 구현 | 구현 | 연결(`/interview/{id}/result`) |
| 6.4 다시보기 | 구현 | 구현 | 연결(`/interview/{id}/replay`) |
| 7.1 날짜별 성장 리뷰 | 구현 | 구현 | 연결(`/reviews/{practiceDate}`) |

실제 BE의 5.13·5.15는 컨트롤러·서비스 테스트가 있으며, 5.15의 입력 검증·월 경계·윤년·0회 채우기 테스트를 통과했다. PostgreSQL 통합 테스트도 통과한다. 6.3·6.4·7.1도 실제 BE에 구현되어 있다(6.4는 녹화 합치기 전·실패 시 `videoUrl` null, B-19 결정 전 임시).

목 서버에서 확인할 날짜는 `2026-10-21`(완료·분석 중), `2026-10-20`(실패·총평 없는 완료)이다. 다른 날짜는 빈 목록을 반환한다. 실행 방법은 [목 서버 README](../mock/README.md)를 따른다.

## 6. 코드 위치

- [실제 BE 컨트롤러](../backend/src/main/java/com/ssafy/a301/interview/controller/InterviewSessionController.java), [조회 서비스](../backend/src/main/java/com/ssafy/a301/interview/service/InterviewSessionListService.java)
- [목 서버 목록 계약·예시](../mock/src/main/java/com/ssafy/a301/interview/InterviewHistoryController.java)
