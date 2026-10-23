# LiveKit 연결 에이전트

LiveKit에 등록하고 배정받은 방에 참가한다. STT·TTS·Jev·BE·녹화 연결은 포함하지 않는다.

## 실행

`ai/`에서 다음 환경변수를 설정한다. 실제 키는 파일이나 Git에 넣지 않는다.

| 변수 | 값 |
| --- | --- |
| `LIVEKIT_URL` | 연결할 LiveKit 주소. 개발은 제공된 Cloud 주소, 전환 후 자체 서버 주소 |
| `LIVEKIT_API_KEY` | 해당 서버 API 키 |
| `LIVEKIT_API_SECRET` | 해당 서버 API 시크릿 |
| `LIVEKIT_AGENT_NAME` | 선택. 기본 `a301-interviewer` |

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

현재는 트랙을 구독하거나 송출하지 않는다. Cloud 전용 호스팅·추론 기능을 사용하지 않으며, 자체 서버로 전환할 때는 주소·키를 교체한다. Agents SDK 버전은 LiveKit 서버 버전과 별도로 관리하며 실제 설치 버전은 `uv.lock`에 고정한다.

## 개발 서버 배포

`deploy/dev/compose.yml`의 `a301-dev-ai-agent`가 위 프로그램을 `start`로 실행한다. 기존 `a301-dev-ai`의 FastAPI는 별도로 실행한다.

GitLab의 `ai-agent-deploy` 잡이 배포한다. `LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`은 `dev/ai-agent`에서도 읽을 수 있는 변수 범위(예: `dev/*`)로 설정해야 한다. 호스트 포트는 열지 않으며, 컨테이너 내부 `http://127.0.0.1:8081/`의 `OK` 응답을 Docker 상태 검사로 확인한다. 파이프라인은 컨테이너가 `healthy`가 될 때까지 기다린다. 실제 방 참가 여부는 별도로 확인한다.
