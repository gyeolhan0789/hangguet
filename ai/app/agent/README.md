# LiveKit STT 에이전트

LiveKit에 등록하고 배정받은 방에서 지원자 마이크를 Soniox에 실시간 전송한다. 확정 텍스트와 토큰별 시각을 에이전트 메모리에 수집한다. 배정 정보의 첫 질문을 ElevenLabs 음성으로 말한다. 다음 질문 진행·Jev·답변 저장·녹화 연결은 포함하지 않는다.

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
| `REDIS_HOST`·`REDIS_PORT` | `question.started`를 보낼 결과 큐(BE와 같은 Redis). 기본 `localhost:6379` |
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

- 첫 일반 참가자(SIP 포함)를 지원자로 선택하고, 그 참가자의 마이크만 구독한다. 테스트 방에는 지원자 한 명으로 접속한다.
- LiveKit에서 16kHz·모노 PCM을 받아 Soniox WebSocket에 직접 보낸다. 기본 STT 플러그인이 합치는 토큰별 시각을 보존하기 위해 직접 연결한다.
- 확정 토큰은 `SonioxSTT.transcript`(`app/interview/realtime/transcript.py`의 `Transcript`)에 보관한다. 시각이 없는 토큰도 글을 보존한다. 중간 결과는 교체하고 `<end>`·`<fin>`은 저장하지 않는다.
- 인식 결과는 LiveKit 텍스트 스트림 `interview.stt`로 선택된 지원자에게만 보낸다. JSON은 `{streamId, revision, confirmedText, interimText, state}`이고 `state`는 `listening` 또는 `failed`다. `streamId`는 해당 캡처 동안 유지되고 `revision`은 증가한다. 화면은 전체 텍스트를 교체하며 토큰별 시각은 에이전트에 남긴다.
- 전송 대기 결과는 최신 하나로 합쳐 느린 수신자가 Soniox 수신을 막지 않게 한다. 종료할 때 마지막 결과 전송을 제한 시간 동안 기다리고 전송 태스크를 정리한다.
- 시각은 Soniox에 보낸 음성 스트림 기준이다. 질문별 분리와 `answerStartedAt` 기준 시각 변환은 아직 연결하지 않았다. 결과는 방 종료 후 저장하지 않는다.
- 지원자가 나가면 현재 음성 전송을 끝내고 마지막 확정 응답을 기다린 뒤 캡처를 정리한다. 에이전트는 방에 남아 재입장을 기다리므로 새로고침 후에도 STT를 다시 시작할 수 있다. 새 캡처에는 새로운 `streamId`를 사용한다. 방 종료·작업 종료 시에는 대기도 정리한다. STT 공급자 오류 시 해당 작업은 실패하며 자동 재연결은 아직 구현하지 않았다.
- `Soniox STT 연결 완료`·`STT 확정 토큰 수신` 로그로 연결·결과 수신을 구분한다. 답변 원문과 키는 로그에 남기지 않는다. 실제 인식 확인은 테스트 음성을 입력하고 수집된 `text`·`transcript`를 검사해야 한다.

## 질문 음성(TTS)

- 에이전트는 참가자 이름 `interviewer`로 들어온다(AI 명세 6.1). 화상 녹화 파일 이름이 이 이름으로 시작한다.
- BE 배정 정보(`ctx.job.metadata`)의 `currentSeq` 질문을 방에 들어오자마자 `POST /v1/text-to-speech/{voice_id}/with-timestamps`(`output_format=pcm_24000`)로 미리 합성한다. 배정 정보가 없으면(`connect --room` 테스트) 질문하지 않는다. 배정 정보가 있는데 형식이 틀리면(질문 5개·채점 기준·512KiB 등, AI 명세 6.1) 방에 들어가지 않고 배정을 거절한다.
- 지원자가 들어오면 ① 결과 큐에 `question.started`(`seq`, `startedAt` 밀리초) ② 지원자에게 `interview.question` RPC `started`(글자별 시각 `alignment.chars`) ③ 마이크 트랙(`interviewer-voice`)으로 음성 송출 ④ `ended` 순으로 보낸다. 합성·송출에 실패하면 `failed`를 보낸다.
- 화면이 RPC를 받지 못해도(처리 함수 없음·3초 응답 없음) 음성은 계속 낸다. 결과 큐 전송이 1·2·4초 재시도 후에도 실패하면 오류 로그만 남긴다.
- 지금은 질문 하나만 말한다. 다음 질문 진행과 새로고침 후 다시 말하기는 아직 없다.

## 꼬리질문(AI 명세 2.2)

- 1번 답변이 끝나면 2번을, 3번 답변이 끝나면 4·5번을 GMS 한 번 호출로 생성한다. 입력은 면접관, 직전 기본 질문의 글·채점 기준, 답변 글(화상은 `answer.completed`의 `content`, 채팅은 `interview.answerSubmit`의 `content`)이다. 면접관별 질문 수준·어조·인재상 기준은 질문 생성(PLAN)과 같은 지침(`app/interview/interviewer.py`)을 사용하되, 악마 면접관의 압박 어조는 지시하지 않는다.
- 생성은 답변 전달을 막지 않는다. 다음 질문 음성 준비가 생성 결과를 기다리므로 답변 전달과 오리 면접관의 효과음 1초 대기는 생성 시간과 겹쳐 계산된다. 생성한 질문은 앞 질문의 음성 합성이 끝난 뒤 합성한다(ElevenLabs 동시 요청을 하나로 유지).
- 답변이 끝난 시점부터 4초(`FOLLOWUP_TIMEOUT`, 임시 값) 안에 생성하지 못하거나, 출력이 JSON이 아니거나 질문 수가 맞지 않거나 질문 글·채점 기준이 비어 있으면 재시도하지 않고 같은 순서의 미리 만든 질문(예비 질문)을 출제한다. 4·5번은 함께 대체한다. GMS 요청도 재시도 없이 4초 타임아웃으로 전송한다.
- 화상 답변을 BE에 전송하지 않았으면(저장할 수 없는 답변) 생성한 질문을 출제하지 않는다. 채팅 `content`가 없거나 비어 있으면 생성하지 않는다. `currentSeq`로 이어 시작해 직전 답변이 없으면 예비 질문이다.
- `question.started`에는 실제로 출제한 질문의 `content`·`criteria`와 `promptVersion`·`modelVersion`을 담는다. 버전은 꼬리질문이면 `followup-v1`과 GMS 응답의 모델 이름이고, 미리 만든 질문이면 둘 다 null이다. 면접방 메시지 `question`의 `content`도 실제로 출제한 질문 글이다.
- 리액션 판단(Jev)도 실제로 출제한 질문 글·채점 기준으로 한다.
- 요청에 답변이 담기므로 질문 글과 답변은 로그에 남기지 않는다. `꼬리질문 생성 완료 ms=…`와 실패 경고 로그로 소요 시간과 대체 여부를 확인한다.

## 면접 화면 연결·검증

화상 면접 화면에서 기존 `useInterviewMedia`의 마이크 트랙을 `useInterviewRoom`이 LiveKit에 송출한다. 입장 정보는 서버 액션이 BE 5.14 `POST /interview-sessions/{sessionId}/room-token`으로 받는다. 브라우저 장치 권한은 기존 것을 사용하며, Soniox 키는 브라우저에 전달하지 않는다.

에이전트는 Soniox 결과를 `interview.stt`로 보내고, 화면의 `AnswerCaption`이 확정 글·미확정 글을 표시한다. 일시적인 LiveKit 끊김은 SDK가 재접속하고, 완전히 끊긴 경우 [다시 연결]로 입장 정보를 새로 받는다. Soniox 오류 안내는 이 재접속과 별개다.

- 확인 완료: 실제 LiveKit에서 테스트 마이크의 PCM 수신, 에이전트의 텍스트 반환·화면 표시, 새로고침 후 새 캡처, 모바일 표시. 이때 Soniox 응답은 모의 처리했다.
- 확인 필요: 실제 Soniox 키를 사용한 한국어 인식·원본 토큰 시각·공급자 오류 처리. 컨테이너 `healthy`나 위 RTC 테스트 통과만으로 실제 인식 성공을 판단하지 않는다.
- 답변 완료 버튼·자동 제출·질문별 저장·다음 질문 진행은 아직 연결하지 않았다.

## 개발 서버 배포

`deploy/dev/compose.yml`의 `a301-dev-ai-agent`가 위 프로그램을 `start`로 실행한다. 기존 `a301-dev-ai`의 FastAPI는 별도로 실행한다.

GitLab의 `ai-agent-deploy` 잡이 배포한다. `LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`·`SONIOX_API_KEY`·`ELEVENLABS_API_KEY`(선택)·`LLM_API_KEY`(선택, 없으면 꼬리질문 없이 진행)는 `dev/ai-agent`에서도 읽을 수 있는 변수 범위(예: `dev/*`)로 설정해야 한다. 호스트 포트는 열지 않으며, 컨테이너 내부 `http://127.0.0.1:8081/`의 `OK` 응답을 Docker 상태 검사로 확인한다. 파이프라인은 컨테이너가 `healthy`가 될 때까지 기다린다. 실제 방 참가·Soniox 연결·인식 결과 수신은 별도로 확인한다.
