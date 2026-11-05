# BE 파트 요청: 에이전트 · Egress ASG 전환 전에 필요한 것

> 근거: [에이전트 · Egress 오토스케일링 계획](README.md) 6.4 · 10.1, [S5 보고서](../../loadtest/report/s5-2026-11-02.md) 요약 · 7장
> 기준 코드: develop `94d73f9`. AI 파트 요청은 [ai-requests.md](ai-requests.md)

ASG 전환은 다음 릴리즈에 넣지 않는다(11/05). 1은 에이전트 전환 전, 2는 Egress 전환 전에 develop에 들어가 있어야 한다. 지금 서버 한 대 구성에서도 같은 일이 생기므로 먼저 넣어도 이득이다.

## 1. 면접관이 들어오지 않으면 시작 실패로 바꾸기

**지금 코드**: `LiveKitInterviewRoom.open()`이 방을 만들고 `createDispatch`가 접수되면 끝난다. 면접은 `IN_PROGRESS`가 되지만, 에이전트가 실제로 들어왔는지는 보지 않는다. `START_FAILED`는 에이전트가 배정 정보가 틀려 거절했을 때(`AiResultService.assignmentRejected`, `assignment.rejected`)만 된다.

**문제**: 에이전트가 모두 가득 차면(CPU 70%) LiveKit은 면접을 배정하지 않고, 거절 메시지도 오지 않는다. 면접관 없이 방만 남고 화면은 계속 기다린다(부하 테스트 H6). ASG에서는 새 인스턴스가 뜨는 3~4분, 대수가 최대에 닿았을 때, Tailscale이 끊겼을 때 이렇게 된다.

**요청**
- 면접 시작(5.4) 뒤 정한 시간(예: 60초) 안에 첫 `question.started`가 오지 않으면, `assignmentRejected`와 같이 `session.failStart()` + `rooms.close(sessionId)`를 한다. 질문이 이미 시작된 면접은 건드리지 않는다
- 화면은 이미 준비되어 있다. `START_FAILED`면 "면접관을 연결하지 못했어요" 모달을 띄우고 [다시 시작]으로 5.4를 다시 부른다(`room-alerts.tsx` `StartFailedModal`). 방을 닫고 다시 만들므로 같은 방에 에이전트가 둘 들어가지 않는다
- 시간 값은 설정으로 둔다. 첫 질문은 입장 뒤 보통 10~15초에 나온다(11/05 개발 서버 15초, 11/03 원격 에이전트 9~14초)

**확인 방법**: 개발 서버에서 에이전트 컨테이너를 멈춘 채 화상 면접을 시작해, 정한 시간 뒤 `START_FAILED`와 모달이 나오는지, 에이전트를 다시 켜고 [다시 시작]하면 정상으로 진행되는지 본다.

## 2. 녹화가 시작되지 않은 트랙 감지

**지금 코드**: 화상 면접은 `LiveKitInterviewRoom.open()`에서 방을 만들 때 자동 트랙 녹화(`RoomEgress` · `AutoTrackEgress`)를 걸고, 녹화가 실제로 시작됐는지는 보지 않는다.

**문제**: Egress가 녹화 요청을 받지 못하면 LiveKit 로그에만 `StartEgress … no response from servers`가 남는다. 면접이 끝난 뒤 합치기가 `TRACK_NOT_FOUND`로 실패해야 드러나고, 사용자는 "녹화를 불러오지 못했어요"만 본다(S5 1회차: 동시 5건부터 녹화가 끝까지 된 면접이 4건에서 멈춤). Egress를 ASG로 옮기면 Egress 0대 · Tailscale 끊김 · 몰려 시작할 때 이 경우가 늘어난다.

**요청**
- 화상 면접에서 트랙이 올라온 뒤(예: 첫 `question.started`를 받을 때) 그 방의 트랙 녹화를 조회해(`EgressServiceClient.listEgress`, 방 이름) 3개(지원자 영상 · 음성, 면접관 음성)가 진행 중인지 본다
- 모자라면 경고 로그를 남기고, 빠진 트랙만 트랙 녹화를 다시 요청한다(`startTrackEgress`, 지금 `trackEgress()`와 같은 S3 설정 · 파일 경로 규칙)
- 다시 요청도 실패하면 면접은 그대로 진행한다(녹화만 빠진다)

**확인 방법**: 개발 서버에서 녹화가 시작되지 않게 만든 뒤(예: Egress S3 키를 잘못된 값으로) 면접을 진행해 경고 로그와 다시 요청이 남는지 본다.

---

Redis 비밀번호는 BE 코드 수정이 필요 없다. BE는 Spring 자동 설정으로 Redis에 붙으므로 인프라가 compose에 `SPRING_DATA_REDIS_PASSWORD`를 넣으면 된다.
