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
| `SONIOX_API_KEY` | Soniox API 키. 없으면 에이전트 실행 실패 |
| `SONIOX_STT_MODEL` | 선택. 기본 `stt-rt-v5` |
| `ELEVENLABS_API_KEY` | 질문 음성 합성 키. 없으면 질문 음성 없이 `question`에 `failed`를 보낸다 |
| `JEV_API_KEY` | 리액션·인상 판단(Jev) 키. 없으면 리액션·인상 판단 없이 진행한다 |
| `REDIS_HOST`·`REDIS_PORT` | `question.started`·`answer.completed`를 전송할 결과 큐(BE와 같은 Redis). 기본 `localhost:6379` |
| `LLM_CHAT_URL`·`LLM_MODEL` | 꼬리질문을 생성할 GMS 주소와 모델 ID(분석 작업자와 같은 값). 하나라도 없거나 등록되지 않은 모델이면 꼬리질문을 생성하지 않고 예비 질문으로 진행한다 |
| `LLM_API_KEY` | GMS 키. 없으면 꼬리질문을 생성하지 않고 예비 질문으로 진행한다 |

```bash
uv sync --locked
uv run python -m app.agent.main dev
```

배포 시에는 같은 명령의 `dev`를 `start`로 바꾼다. FastAPI와 별도 프로세스로 실행한다.

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
- 지원자 퇴장·재입장과 STT 오류의 처리 규칙은 AI 명세 6.5에 있다. 시험 방에서는 마지막 확정 응답을 기다린 뒤 캡처를 정리하고 새 `streamId`로 다시 시작한다. 방 종료·작업 종료 시에는 대기도 정리한다. STT 자동 재연결은 아직 구현하지 않았다.
- `Soniox STT 연결 완료`·`STT 확정 토큰 수신` 로그로 연결·결과 수신을 구분한다. 답변 원문과 키는 로그에 남기지 않는다. 실제 인식 확인은 테스트 음성을 입력하고 수집된 `text`·`transcript`를 검사해야 한다.

## 질문 음성(TTS)

- 에이전트 참가자 이름은 AI 명세 6.1의 `interviewer`다.
- BE 배정 정보(`ctx.job.metadata`)의 `currentSeq` 질문과 다음 질문을, 앞 질문의 합성이 끝난 뒤 하나씩 `POST /v1/text-to-speech/{voice_id}/with-timestamps`(`output_format=pcm_24000`)로 미리 합성한다. 배정 정보가 없으면(`connect --room` 테스트) 질문하지 않는다. 배정 정보 형식이 틀리면 방에 들어가지 않고 배정을 거절하며, BE가 면접을 시작 실패로 처리하도록 `assignment.rejected`(`INVALID_ASSIGNMENT`)를 전송한다(AI 명세 6.5).
- 질문 시작(`question.started`)과 화면 메시지(`interview.question`)는 AI 명세 6.2·6.3대로 전송한다. `question.started`는 음성 송출을 시작하는 시점(음성이 없으면 `failed`를 전송하기 직전)에 질문마다 한 번 별도 작업으로 전송하고, 음성은 마이크 트랙(`interviewer-voice`)으로 송출한다.
- 질문 시작(`question.started`) 전송이 재시도 후에도 실패하면 AI 명세 6.5와 달리 오류 로그만 남긴다. 재전송은 아직 구현하지 않았다.

## 꼬리질문

- 출제 순서·입력·생성 지침·예비 질문·버전 규칙은 AI 명세 2.2를 따른다. 면접관별 지침은 질문 생성과 같은 `app/interview/interviewer.py`를, 생성 요청과 출력 검증은 `app/interview/realtime/followup.py`를 사용한다.
- 생성은 답변 전달을 막지 않는다. 다음 질문 음성 준비가 생성 결과를 기다리므로 답변 전달과 오리 면접관의 효과음 1초 대기는 생성 시간과 겹쳐 계산된다. 생성한 질문은 앞 질문의 음성 합성이 끝난 뒤 합성한다(ElevenLabs 동시 요청을 하나로 유지).
- 대기 상한은 `FOLLOWUP_TIMEOUT`에 두고, GMS 요청도 재시도 없이 같은 시간 제한으로 전송한다.
- `currentSeq`로 이어 시작해 직전 답변이 없으면 예비 질문을 출제한다.
- 요청에 답변이 담기므로 질문 글과 답변은 로그에 남기지 않는다. `꼬리질문 생성 완료 ms=…`와 실패 경고 로그로 소요 시간과 대체 여부를 확인한다.

## 면접 화면 연결

화면의 면접방 연결과 재접속은 AI 명세 6.3·6.5를 따른다.

## 개발 서버 배포

`deploy/dev/compose.yml`의 `a301-dev-ai-agent`가 위 프로그램을 `start`로 실행한다. 기존 `a301-dev-ai`의 FastAPI는 별도로 실행한다.

GitLab의 `ai-agent-deploy` 잡이 배포한다. `LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`·`SONIOX_API_KEY`·`ELEVENLABS_API_KEY`(선택)·`JEV_API_KEY`(선택, 없으면 리액션·인상 판단 없이 진행)·`LLM_API_KEY`(선택, 없으면 꼬리질문 없이 진행)는 `dev/ai-agent`에서도 읽을 수 있는 변수 범위(예: `dev/*`)로 설정해야 한다. 호스트 포트는 열지 않으며, 컨테이너 내부 `http://127.0.0.1:8081/`의 `OK` 응답을 Docker 상태 검사로 확인한다. 파이프라인은 컨테이너가 `healthy`가 될 때까지 기다린다. 실제 방 참가·Soniox 연결·인식 결과 수신은 별도로 확인한다.
