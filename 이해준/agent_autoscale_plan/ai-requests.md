# AI 파트 요청: 에이전트 ASG 전환 전에 필요한 것

> 근거: [에이전트 · Egress 오토스케일링 계획](README.md) 5.2 · 10.1, [scale out 보고서](../../loadtest/report/scaleout-2026-11-03.md) 4장
> 기준 코드: develop `94d73f9`. BE 파트 요청은 [be-requests.md](be-requests.md)

ASG 전환은 다음 릴리즈에 넣지 않는다(11/05). 아래는 전환 전에 develop에 들어가 있어야 한다. 1이 AI 파트에 부탁할 일이고, 2는 인프라가 반영했다. 둘 다 문제가 없을 때는 지금과 똑같이 동작하므로 먼저 넣어도 된다.

## 1. 질문 음성 재생에 시간 상한

**지금 코드**: `ai/app/agent/question.py` `QuestionSpeaker._play()`가 프레임을 모두 넣은 뒤 `source.wait_for_playout()`을 상한 없이 기다린다. 부르는 쪽(`interview.py` `InterviewRunner._speak()`)도 재생이 끝나거나 지원자가 나갈 때까지만 기다린다.

**문제**: 에이전트 → LiveKit 송출이 그 순간 흐르지 않으면 재생이 끝나지 않아 면접이 그 질문에서 멈춘다. 지원자가 나갈 때까지 아무 기록이 남지 않는다. 에이전트를 떼어 낸 직후 시험에서 20건 중 5건이 이렇게 멈췄다(11/03, 로그에는 `질문 상태 화면 전달 실패 speech=started code=timeout`만 남음). 에이전트가 원격 인스턴스가 되면 메인 서버와 사이의 경로가 늘어난다.

**요청**
- `_play()`에 상한을 둔다. 예: 음성 길이 + 10초
- 넘기면 `clear_queue()`로 남은 음성을 버리고, 화면에 `failed`를 알린 뒤 답변 듣기로 넘어간다(TTS 실패와 같은 처리, AI 명세 6.5). 화면은 질문 글을 보여 주고 있어 면접을 이어 갈 수 있다
- 발화 중단 안내(`say()`)도 같은 `_play()`를 쓰므로 함께 적용된다

**확인 방법**: `capture_frame` · `wait_for_playout`이 끝나지 않는 가짜 `AudioSource`로 단위 테스트를 만들어, 상한 뒤 `failed` 알림과 답변 단계 진입을 확인한다.

## 2. `REDIS_PASSWORD` 읽기 — 인프라가 반영(11/05, S15P31A301-404)

`app/common/settings.py`에 `REDIS_PASSWORD`(선택)를 더하고 `app/common/redis.py`의 `create_redis()` · `create_publisher_redis()`가 `password`로 넘긴다. 값이 없거나 빈 값이면 지금처럼 비밀번호 없이 붙는다. 테스트는 `tests/common/test_redis.py` · `test_settings.py`. AI 파트는 리뷰만 부탁한다.

값은 인프라가 넣는다: 메인 서버는 GitLab CI/CD 변수 `REDIS_PASSWORD`를 compose `environment:`로, 에이전트 ASG는 SSM(`/a301/prod/agent/*`)에서 user data가 읽어 넘긴다.

---

11/03에 요청했던 프로세스 미리 띄우기(`AGENT_IDLE_PROCESSES`)와 녹화 합치기의 같은 종류 파일 이어 붙이기(`recording/merge.py`)는 반영되었다. 나머지 개선(부하 판단 `load_fnc`, 채점 병렬, 작업자별 처리 중 목록 등)은 전환 조건이 아니라 이 문서에서 뺐다.
