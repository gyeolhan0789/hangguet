# LiveKit STT 에이전트

LiveKit에 등록하고 배정받은 방에서 지원자 마이크를 Soniox에 실시간 전송한다. 확정 텍스트와 토큰별 시각을 에이전트 메모리에 수집한다. TTS·Jev·BE 저장·녹화 연결은 포함하지 않는다.

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
- `SonioxSTT.tokens`에 확정 토큰의 `text`·`start_ms`·`end_ms`를 보관한다. 시각이 없는 토큰은 `None`을 유지한다. 중간 결과는 교체하고 `<end>`·`<fin>`은 저장하지 않는다.
- 인식 결과는 LiveKit 텍스트 스트림 `interview.stt`로 선택된 지원자에게만 보낸다. JSON은 `{streamId, revision, confirmedText, interimText, state}`이고 `state`는 `listening` 또는 `failed`다. `streamId`는 해당 캡처 동안 유지되고 `revision`은 증가한다. 화면은 전체 텍스트를 교체하며 토큰별 시각은 에이전트에 남긴다.
- 전송 대기 결과는 최신 하나로 합쳐 느린 수신자가 Soniox 수신을 막지 않게 한다. 종료할 때 마지막 결과 전송을 제한 시간 동안 기다리고 전송 태스크를 정리한다.
- 시각은 Soniox에 보낸 음성 스트림 기준이다. 질문별 분리와 `answerStartedAt` 기준 시각 변환은 아직 연결하지 않았다. 결과는 방 종료 후 저장하지 않는다.
- 지원자가 나가면 현재 음성 전송을 끝내고 마지막 확정 응답을 기다린 뒤 캡처를 정리한다. 에이전트는 방에 남아 재입장을 기다리므로 새로고침 후에도 STT를 다시 시작할 수 있다. 새 캡처에는 새로운 `streamId`를 사용한다. 방 종료·작업 종료 시에는 대기도 정리한다. STT 공급자 오류 시 해당 작업은 실패하며 자동 재연결은 아직 구현하지 않았다.
- `Soniox STT 연결 완료`·`STT 확정 토큰 수신` 로그로 연결·결과 수신을 구분한다. 답변 원문과 키는 로그에 남기지 않는다. 실제 인식 확인은 테스트 음성을 입력하고 수집된 `text`·`tokens`를 검사해야 한다.

## 면접 화면 연결·검증

화상 면접 화면에서 기존 `useInterviewMedia`의 마이크 트랙을 `useInterviewRoom`이 LiveKit에 송출한다. 입장 정보는 서버 액션이 BE 5.14 `POST /interview-sessions/{sessionId}/room-token`으로 받는다. 브라우저 장치 권한은 기존 것을 사용하며, Soniox 키는 브라우저에 전달하지 않는다.

에이전트는 Soniox 결과를 `interview.stt`로 보내고, 화면의 `AnswerCaption`이 확정 글·미확정 글을 표시한다. 일시적인 LiveKit 끊김은 SDK가 재접속하고, 완전히 끊긴 경우 [다시 연결]로 입장 정보를 새로 받는다. Soniox 오류 안내는 이 재접속과 별개다.

- 확인 완료: 실제 LiveKit에서 테스트 마이크의 PCM 수신, 에이전트의 텍스트 반환·화면 표시, 새로고침 후 새 캡처, 모바일 표시. 이때 Soniox 응답은 모의 처리했다.
- 확인 필요: 실제 Soniox 키를 사용한 한국어 인식·원본 토큰 시각·공급자 오류 처리. 컨테이너 `healthy`나 위 RTC 테스트 통과만으로 실제 인식 성공을 판단하지 않는다.
- 답변 완료 버튼·자동 제출·질문별 저장·다음 질문 진행은 아직 연결하지 않았다.

## 개발 서버 배포

`deploy/dev/compose.yml`의 `a301-dev-ai-agent`가 위 프로그램을 `start`로 실행한다. 기존 `a301-dev-ai`의 FastAPI는 별도로 실행한다.

GitLab의 `ai-agent-deploy` 잡이 배포한다. `LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`·`SONIOX_API_KEY`는 `dev/ai-agent`에서도 읽을 수 있는 변수 범위(예: `dev/*`)로 설정해야 한다. 호스트 포트는 열지 않으며, 컨테이너 내부 `http://127.0.0.1:8081/`의 `OK` 응답을 Docker 상태 검사로 확인한다. 파이프라인은 컨테이너가 `healthy`가 될 때까지 기다린다. 실제 방 참가·Soniox 연결·인식 결과 수신은 별도로 확인한다.
