# 면접 에이전트

LiveKit에 등록하고 배정받은 면접방에서 질문 5개를 진행한다. 질문을 ElevenLabs 음성으로 출제하고, 지원자 답변을 Soniox로 인식해 답변 종료를 판단한 뒤 `answer.completed`로 BE에 전송한다. 답변 중에는 Jev로 리액션과 인상을 판단하고, 1·3번 답변 뒤에는 꼬리질문을 생성한다. 녹화 시작과 합치기는 포함하지 않는다. 질문 진행·답변 종료·리액션·실패 처리의 세부 규칙은 AI 명세 6장을 따른다.

## 실행

`ai/`에서 다음 환경변수를 설정한다. 실제 키는 파일이나 Git에 넣지 않는다.

| 변수 | 값 |
| --- | --- |
| `LIVEKIT_URL` | 연결할 LiveKit 주소. 개발은 제공된 Cloud 주소, 전환 후 자체 서버 주소 |
| `LIVEKIT_API_KEY` | 해당 서버 API 키 |
| `LIVEKIT_API_SECRET` | 해당 서버 API 시크릿 |
| `LIVEKIT_AGENT_NAME` | 선택. 기본 `a301-interviewer` |
| `AGENT_IDLE_PROCESSES` | 선택. 미리 실행해 두는 프로세스 수(0 이상의 정수). 없으면 라이브러리 기본값(운영 모드는 CPU 수, `dev`는 0) |
| `SONIOX_API_KEY` | Soniox API 키. 없으면 에이전트 실행 실패 |
| `SONIOX_STT_MODEL` | 선택. 기본 `stt-rt-v6` |
| `ELEVENLABS_API_KEY` | 질문 음성 합성 키. 없으면 질문 음성 없이 `question`에 `failed`를 보낸다 |
| `JEV_API_KEY` | 리액션·인상 판단(Jev) 키. 없으면 리액션·인상 판단 없이 진행한다 |
| `REDIS_HOST`·`REDIS_PORT` | `question.started`·`answer.completed`를 전송할 결과 큐(BE와 같은 Redis). 기본 `localhost:6379` |
| `REDIS_PASSWORD` | 선택. Redis `requirepass` 비밀번호. 없으면 비밀번호 없이 연결한다 |
| `LLM_CHAT_URL`·`LLM_MODEL` | 꼬리질문을 생성할 GMS 주소와 모델 ID(분석 작업자와 같은 값). 하나라도 없거나 등록되지 않은 모델이면 꼬리질문을 생성하지 않고 예비 질문으로 진행한다 |
| `LLM_API_KEY` | GMS 키. 없으면 꼬리질문을 생성하지 않고 예비 질문으로 진행한다 |

```bash
uv sync --locked
uv run python -m app.agent.main dev
```

배포 시에는 같은 명령의 `dev`를 `start`로 바꾼다. FastAPI와 별도 프로세스로 실행한다.

미리 실행해 두는 프로세스 수를 0으로 두면 빈 서버에서 동시에 시작한 두 번째 면접의 배정을 거절한다(이유는 `main.py` 주석).

등록만 하면 방에 자동 입장하지 않는다. LiveKit의 명시적 배정 기능으로 위 에이전트 이름과 방 이름을 지정해야 한다. 배정 후 `LiveKit 방 참가 완료` 로그를 확인한다. 방을 닫으면 연결이 정리된다.

BE 배정 연동 없이 특정 테스트 방에 직접 연결하려면 다음 명령을 사용한다.

```bash
uv run python -m app.agent.main connect --room agent-connection-test
```

Cloud 전용 호스팅·추론 기능을 사용하지 않으며, 자체 서버로 전환할 때는 주소·키를 교체한다. Agents SDK 버전은 LiveKit 서버 버전과 별도로 관리하며 실제 설치 버전은 `uv.lock`에 고정한다.

## STT 동작

- 면접에서는 참가자 이름 `candidate`(AI 명세 6.1)의 마이크만 구독하고(화상만), 채팅 면접은 마이크를 구독하지 않는다. 배정 없이 `connect --room`으로 연결한 시험 방에서는 첫 일반 참가자(SIP 포함)를 지원자로 선택한다.
- LiveKit에서 16kHz·모노 PCM을 받아 Soniox WebSocket에 직접 전송한다(직접 연결하는 이유는 AI 명세 6장).
- 확정 토큰은 `SonioxSTT.transcript`(`app/interview/realtime/transcript.py`의 `Transcript`)에 보관한다. 시각이 없는 토큰도 글을 보존한다.
- 인식 결과는 AI 명세 6.3의 `interview.stt` 형식으로 지원자에게만 전송한다.
- 전송 대기 결과는 최신 하나로 합쳐 느린 수신자가 Soniox 수신을 막지 않게 한다. 종료할 때 마지막 결과 전송을 제한 시간 동안 기다리고 전송 태스크를 정리한다.
- 답변마다 Soniox 연결을 새로 연다. Soniox 시각은 연결마다 0부터 시작하므로 토큰 시각이 `answerStartedAt`(AI 명세 6.2) 기준이 된다.
- 지원자 퇴장·재입장과 STT 오류의 처리 규칙은 AI 명세 6.5에 있다. 시험 방에서는 마지막 확정 응답을 기다린 뒤 캡처를 정리하고 새 `streamId`로 다시 시작한다. 방 종료·작업 종료 시에는 대기도 정리한다.
- Soniox 연결이 실패하거나 끊기거나, 음성을 전송했는데 5초 동안 응답이 없으면 다시 연결한다(최대 3회, AI 명세 6.5). 다시 연결하는 동안의 음성은 전송하지 않고, 인식하지 못한 구간은 `answer.completed`의 `sttGaps`로 전달한다. 다시 연결하지 못하면 그때까지 인식된 글을 `STT_FAILED`로 제출하고(글이 없으면 전송하지 않음) 다음 질문으로 진행한다.
- `Soniox STT 다시 연결 n/3: 이유, 마지막 응답 뒤 n초`·`Soniox STT 다시 연결 완료` 로그로 재연결을, `답변 음성 인식 실패` 로그의 호출 경로로 실패 원인을 확인한다.
- 재연결 로그의 `reason` 필드는 끊긴 원인이다: `connect_failed`(연결 실패), `no_response`(음성을 전송했는데 응답 없음), `soniox_error`(Soniox 오류 응답, `detail`에 오류 코드), `closed`(종료 응답 없이 연결이 닫힘), `receive_failed`·`send_failed`·`keepalive_failed`(수신·전송·연결 유지 오류), `finished_early`(음성을 다 전송하기 전에 종료 응답).
- 답변이 끝나면 `Soniox STT 답변 종료: 결과` 로그를 한 줄 남긴다. `result`는 `completed`·`reconnect_failed`·`audio_failed`(지원자 음성 읽기 실패)·`failed`·`cancelled`이고, `audio_ms`(읽은 음성)·`sent_ms`(전송한 음성)·`responses`(수신한 응답 수)·`final_tokens`·`first_audio_ms`·`first_response_ms`·`reconnects`·`gap_ms`·`failures`(끊긴 원인 순서)를 함께 남긴다. 인식 결과가 비었으면 `audio_ms`가 0인지(음성 미도착), `responses`가 0인지(Soniox 무응답), `final_tokens`가 0인지(빈 응답)로 원인을 구분한다.
- `Soniox STT 연결 완료`·`STT 확정 토큰 수신` 로그로 연결·결과 수신을 구분한다. 답변 원문과 키는 로그에 남기지 않는다. 실제 인식 확인은 테스트 음성을 입력하고 수집된 `text`·`transcript`를 검사해야 한다.

## 질문 음성(TTS)

- 에이전트 참가자 이름은 AI 명세 6.1의 `interviewer`다.
- BE 배정 정보(`ctx.job.metadata`)의 `currentSeq` 질문과 다음 질문을, 앞 질문의 합성이 끝난 뒤 하나씩 `POST /v1/text-to-speech/{voice_id}/with-timestamps`(`output_format=pcm_24000`)로 미리 합성한다. 배정 정보가 없으면(`connect --room` 테스트) 질문하지 않는다. 배정 정보 형식이 틀리면 방에 들어가지 않고 배정을 거절하며, BE가 면접을 시작 실패로 처리하도록 `assignment.rejected`(`INVALID_ASSIGNMENT`)를 전송한다(AI 명세 6.5).
- 질문 시작(`question.started`)과 화면 메시지(`interview.question`)는 AI 명세 6.2·6.3대로 전송한다. `question.started`는 음성 송출을 시작하는 시점(음성이 없으면 `failed`를 전송하기 직전)에 질문마다 한 번 별도 작업으로 전송하고, 음성은 마이크 트랙(`interviewer-voice`)으로 송출한다.
- 오리 면접관은 답변을 전달하고 효과음 길이(1초)만큼 기다린 뒤 칭찬 한 문장을 같은 트랙으로 송출하고 다음 질문으로 진행한다(AI 명세 6.2). 칭찬 음성은 `duck_praise/`에 미리 합성해 둔 PCM(오리 면접관 음성 id, `eleven_multilingual_v2`, `pcm_24000`)이며, 문장(`app/interview/realtime/praise.py`)을 변경하면 같은 설정으로 다시 합성해 교체한다. 선택한 칭찬은 `칭찬 praise=` 로그로 확인한다.
- 질문 시작(`question.started`) 전송이 재시도 후에도 실패해도 질문은 그대로 진행하고, 전송에 성공하거나 면접이 끝날 때까지 4초 간격으로 다시 전송한다. 화상 답변은 그 질문의 `question.started`를 전송한 뒤에만 `answer.completed`로 전달하고, 전송하지 못했으면 `submitFailed`를 알린다(AI 명세 6.5).

## 꼬리질문

- 출제 순서·입력·생성 지침·예비 질문·버전 규칙은 AI 명세 2.2를 따른다. 면접관별 지침은 질문 생성과 같은 `app/interview/interviewer.py`를, 생성 요청과 출력 검증은 `app/interview/realtime/followup.py`를 사용한다.
- 생성은 답변 전달을 막지 않는다. 다음 질문 음성 준비가 생성 결과를 기다리므로 답변 전달과 오리 면접관의 효과음 1초 대기·칭찬은 생성 시간과 겹쳐 계산된다. 생성한 질문은 앞 질문의 음성 합성이 끝난 뒤 합성한다(ElevenLabs 동시 요청을 하나로 유지).
- 대기 상한은 `FOLLOWUP_TIMEOUT`에 두고, GMS 요청도 재시도 없이 같은 시간 제한으로 전송한다.
- `currentSeq`로 이어 시작해 직전 답변이 없으면 예비 질문을 출제한다.
- 요청에 답변이 담기므로 질문 글과 답변은 로그에 남기지 않는다. `꼬리질문 생성 완료 ms=…`와 실패 경고 로그로 소요 시간과 대체 여부를 확인한다.

## 그룹 면접

- 배정 정보의 `kind`가 `GROUP`이면 그룹 면접이다(AI 명세 6.7). 방 이름은 `group-{groupId}`, 지원자 참가자 이름은 `candidate-{sessionId}`다. 형식이 틀리면 `groupId`를 담아 그룹 결과 큐(`ai:results:group`)로 `assignment.rejected`를 보낸다.
- 진행은 BE가 정한다. `group_room.py`가 면접방 정보(room metadata)를 접속할 때와 바뀔 때 읽어 `turnVersion`이 가장 큰 것만 남기고, `group_interview.py`의 `GroupInterviewRunner`가 단계(`ASKING`·`SPEAKING`·`ANSWERING`·`DECIDING`·`WAITING`)를 따라 움직인다. 더 새 차례·단계가 오면 말하던 음성이나 듣던 답변을 멈춘다.
- 질문 음성은 차례가 오는 순서(공통1 → 호명 → 참가자별 개인1 → 공통2 → 참가자별 개인2)로 하나씩 미리 합성한다. BE는 차례를 정하고 20초(+10초) 안에 `question.started`가 오지 않으면 AI 정체로 본다.
- 그 차례 답변자의 마이크만 구독한다. 화상 답변은 7초 침묵 · `[답변 완료]` · 마감(`deadlineAt`) 중 먼저 오는 것으로 끝내고, 마감에는 말한 게 있을 때만 `TIME_LIMIT`으로 낸다. 60초 무응답 안내는 보내지 않는다.
- 채팅 답변은 듣지 않는다(BE가 확정한다). `ASKING`부터 `DECIDING`·다음 차례 전까지 지금 답변자가 지금 질문으로 보낸 `chat.input`만 받아 리액션을 판단하고 모두에게 보낸다.
- 꼬리질문 판단(`DECIDING`)은 최종 답변(화상은 보낸 `answer.completed`의 글, 채팅은 BE가 보낸 `group.answer`의 글)으로 GMS에 한 번 물어 필요한지 정하고, 필요하면 질문 하나를 만들어 `followup.decided`로 보낸다. 판단하지 못하면 `needed: false`를 바로 보낸다. 만든 꼬리질문은 음성을 미리 합성해 두고 그 사람의 `FOLLOWUP` 차례에 말하며, 다른 차례가 오면 버린다. `group.answer`는 BE 서버가 보낸 것만 받는다.
- 오리 면접관은 1초 기다렸다가 칭찬한다. 화상은 답변을 전달한 뒤, 채팅은 `DECIDING`이 오면 하고, 그 사람이 마지막 질문을 마쳤으면(`DONE`·`ENDED`) 하지 않는다. 마지막일 수 있는 질문(4번째 기본 질문과 그 뒤 꼬리질문)은 BE가 그 차례를 넘긴 뒤 칭찬한다.
- 결과 메시지는 모두 `ai:results:group`으로 보내고 받은 방 정보의 `turnVersion`을 담는다. `room.closed`는 보내지 않는다.

## 면접 화면 연결

화면의 면접방 연결과 재접속은 AI 명세 6.3·6.5를 따른다.

## 개발 서버 배포

`deploy/dev/compose.yml`의 `a301-dev-ai-agent`가 위 프로그램을 `start`로 실행한다. 기존 `a301-dev-ai`의 FastAPI는 별도로 실행한다.

GitLab의 `ai-agent-deploy` 잡이 배포한다. `LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`·`SONIOX_API_KEY`·`ELEVENLABS_API_KEY`(선택)·`JEV_API_KEY`(선택, 없으면 리액션·인상 판단 없이 진행)·`LLM_API_KEY`(선택, 없으면 꼬리질문 없이 진행)는 `dev/ai-agent`에서도 읽을 수 있는 변수 범위(예: `dev/*`)로 설정해야 한다. 호스트 포트는 열지 않으며, 컨테이너 내부 `http://127.0.0.1:8081/`의 `OK` 응답을 Docker 상태 검사로 확인한다. 파이프라인은 컨테이너가 `healthy`가 될 때까지 기다린다. 실제 방 참가·Soniox 연결·인식 결과 수신은 별도로 확인한다.
