# 에이전트 분리 · scale out (테스트 환경)

AI 면접관(에이전트)을 테스트 서버에서 떼어 EC2 Auto Scaling Group(ASG)으로 띄운다. 기준 문서는 [에이전트 오토스케일링 계획](../../이해준/agent_autoscale_plan/README.md)이다.
지금 단계는 **대수를 직접 정해 고정하는 scale out**(계획 9장 검증 1~3단계)이다. 확장 정책 · 수명 주기 훅 · CloudWatch 지표는 다음 단계에서 붙인다.

```
메인(테스트) 서버 a301-loadtest ──(사설망) LiveKit 7880 · Redis 6379──▶ 에이전트 ASG(t3.medium, 고정 N대)
      │                                                                  │ Soniox · ElevenLabs · Jev(인터넷)
      └── 사용자 · 에이전트 미디어: 공인 IP의 UDP 7882 ◀──────────────────┘
```

## 파일

| 파일 | 내용 |
|---|---|
| `user-data.sh` | 시작 템플릿 user data. Docker 설치 → SSM에서 값 읽기 → 이미지 받기 → 에이전트 컨테이너 실행 |
| `aws/agent-role-policy.json` | 에이전트 인스턴스 역할의 인라인 정책(SSM 매개변수 읽기 · 복호화) |
| `../server/compose.agent-split.yml` | 메인 서버 덮어쓰기: 메인 서버의 에이전트 끄기, LiveKit 7880 · Redis 6379를 사설 IP에만 열기 |

## 테스트 서버 네트워크(11/03 확인)

| 항목 | 값 |
|---|---|
| VPC | 기본 VPC `vpc-04fb6069bfe35bf74`(172.31.0.0/16) |
| 테스트 서버 서브넷 · 가용 영역 | `subnet-03a638f16b98edef3`(172.31.48.0/20) · `ap-northeast-2d` |
| 테스트 서버 보안 그룹 | `a301-loadtest`(`sg-02d8b2ed71ddfed50`) |
| 테스트 서버 사설 IP | `hostname -I`의 첫 값(서버를 지우고 다시 만들면 바뀐다) |

## 만들기(AWS 콘솔, 서울 리전)

비밀값은 콘솔에 직접 넣는다. 대화 · 문서 · 커밋에 붙여 넣지 않는다.

### 1. 보안 그룹

1. **EC2 → 보안 그룹 → 보안 그룹 생성**: 이름 `a301-loadtest-agent`, VPC는 위 기본 VPC
   - 인바운드 규칙: **없음**(에이전트는 받는 포트가 없다. 접속은 Session Manager)
   - 아웃바운드 규칙: 기본값(전체 허용) 그대로
2. 테스트 서버 보안 그룹 `a301-loadtest` → **인바운드 규칙 편집**에서 두 줄을 더한다
   - 사용자 지정 TCP `7880`, 소스 `a301-loadtest-agent`(보안 그룹), 설명 `LiveKit signaling from agent`
   - 사용자 지정 TCP `6379`, 소스 `a301-loadtest-agent`(보안 그룹), 설명 `Redis from agent`
   - UDP 7882 · TCP 7881 · 443은 이미 열려 있다(사용자 미디어). 에이전트 미디어도 이 경로를 쓴다

### 2. SSM Parameter Store

**Systems Manager → Parameter Store → 매개변수 생성**. 이름 앞부분은 모두 `/a301/loadtest/agent/`다.

| 이름 | 유형 | 값 |
|---|---|---|
| `image-tag` | String | 테스트 서버와 같은 태그(지금 `e9874c74`) |
| `livekit-url` | String | `ws://<테스트 서버 사설 IP>:7880` |
| `redis-host` | String | `<테스트 서버 사설 IP>` |
| `dockerhub-user` | String | `hanggeut` |
| `dockerhub-token` | SecureString | Docker Hub 읽기 토큰(테스트 서버에서 이미지를 받을 때 쓴 것) |
| `livekit-api-key` | SecureString | 테스트 서버 `loadtest/server/.env`의 `LIVEKIT_API_KEY` |
| `livekit-api-secret` | SecureString | 같은 파일의 `LIVEKIT_API_SECRET` |
| `soniox-api-key` | SecureString | 같은 파일의 `SONIOX_API_KEY` |
| `elevenlabs-api-key` | SecureString | 같은 파일의 `ELEVENLABS_API_KEY` |
| `jev-api-key` | SecureString | 같은 파일의 `JEV_API_KEY` |

- SecureString은 기본 키(`aws/ssm`)로 암호화한다
- 하나라도 없으면 user data가 멈추고 에이전트가 뜨지 않는다(`/var/log/a301-agent-userdata.log`)

### 3. IAM 역할

1. **IAM → 역할 → 역할 생성**: 신뢰할 수 있는 엔터티 `AWS 서비스 · EC2`
2. 권한 정책: AWS 관리형 `AmazonSSMManagedInstanceCore`(Session Manager 접속)
3. 이름 `a301-loadtest-agent`로 만든 뒤, **권한 추가 → 인라인 정책 생성 → JSON**에 `aws/agent-role-policy.json` 내용을 붙여 넣는다(정책 이름 `a301-loadtest-agent-ssm`)

### 4. 시작 템플릿

**EC2 → 시작 템플릿 → 시작 템플릿 생성**, 이름 `a301-loadtest-agent`

| 항목 | 값 |
|---|---|
| AMI | Amazon Linux 2023 AMI(64비트 x86) |
| 인스턴스 유형 | `t3.medium` |
| 키 페어 | 포함하지 않음(Session Manager로 접속) |
| 네트워크 설정 | 서브넷은 **템플릿에 포함하지 않음**(ASG가 고른다), 보안 그룹 `a301-loadtest-agent` |
| 스토리지 | 루트 볼륨 gp3 30GiB |
| 리소스 태그 | `Name=a301-loadtest-agent`, `a301-role=agent`(인스턴스 · 볼륨) |
| 고급 세부 정보 → IAM 인스턴스 프로파일 | `a301-loadtest-agent` |
| 고급 세부 정보 → 크레딧 사양 | **무제한(Unlimited)** |
| 고급 세부 정보 → 메타데이터 버전 | V2만(토큰 필요) |
| 고급 세부 정보 → 사용자 데이터 | `user-data.sh` 내용 전체 |

### 5. Auto Scaling Group(고정 대수)

**EC2 → Auto Scaling 그룹 → 생성**, 이름 `a301-loadtest-agent`

| 항목 | 값 |
|---|---|
| 시작 템플릿 | `a301-loadtest-agent`(최신 버전) |
| VPC · 서브넷 | 기본 VPC, 가용 영역이 다른 기본 서브넷 2개 이상(예: `ap-northeast-2a` · `ap-northeast-2c`). 기본 서브넷은 공인 IP를 자동으로 붙여 인터넷(외부 API)에 나갈 수 있다 |
| 로드 밸런서 | 없음 |
| 상태 확인 | EC2, 유예 기간 300초 |
| 그룹 크기 | 원하는 **1** · 최소 **1** · 최대 **1**(scale out 시험 때 원하는 · 최대를 2로) |
| 크기 조정 정책 | **없음** |

## 메인(테스트) 서버 바꾸기

```bash
cd ~/a301
# .env에 사설 IP를 넣는다
echo "MAIN_PRIVATE_IP=$(hostname -I | awk '{print $1}')" >> loadtest/server/.env

COMPOSE="docker compose --env-file loadtest/server/.env -f deploy/prod/compose.yml -f loadtest/server/compose.loadtest.yml -f loadtest/server/compose.agent-split.yml"
$COMPOSE up -d
docker rm -f a301-prod-ai-agent          # 메인 서버의 에이전트를 내린다
docker ps --format '{{.Names}} {{.Ports}}' | grep -E 'livekit|redis'   # 7880 · 6379가 사설 IP에만 열렸는지
```

되돌리기: `compose.agent-split.yml` 없이 `up -d`(에이전트가 다시 뜨고 7880 · 6379는 닫힌다). ASG의 원하는 대수는 0으로 둔다.

## 확인

1. 에이전트 인스턴스: **EC2 → 인스턴스 → 연결 → Session Manager**
   ```bash
   sudo tail -n 30 /var/log/a301-agent-userdata.log
   sudo docker ps --format '{{.Names}} {{.Status}}'          # healthy
   sudo docker logs a301-ai-agent 2>&1 | grep -iE 'registered|error' | tail
   ```
2. 메인 서버: LiveKit에 에이전트가 등록됐는지
   ```bash
   docker logs a301-prod-livekit 2>&1 | grep -i 'worker' | tail -5
   ```
3. 로컬 PC: 화상 면접 1건(녹화 · 결과 · 다시보기까지)
   ```bash
   N=1 bash loadtest/run.sh scenarios/s5-interview-browser.js
   ```

## scale out 시험(계획 9장 1~3단계)

| 단계 | ASG 원하는 · 최대 | 부하(로컬 PC) |
|---|---|---|
| 1. 기능 | 1 · 1 | 위 확인 3번 + 면접 중 Session Manager에서 `sudo docker stop --time 1800 a301-ai-agent`(진행 면접이 끝까지 가는지) |
| 2. 분리 효과 | 2 · 2 | `MIX=0/0/0/5/8m,0/0/0/8/8m,0/0/0/10/8m REST=2m bash loadtest/run.sh scenarios/s6-peak-browser.js`(화상 면접만 5 · 8 · 10건) |
| 3. 한 대 한계 | 1 · 1 | 같은 명령. 대당 약 9건에서 새 면접을 거절하는지 |

- 분리 전 기준값: [S5 보고서](../report/s5-2026-11-02.md) 9장(5 · 8 · 10건 서버 CPU 43 · 61 · 68%)
- 회차 전에 테스트 서버의 자동 업데이트를 끄거나 미리 돌린다([S6 보고서](../report/s6-2026-11-03.md) 6장)

## 정리 · 비용

- 시험하지 않을 때는 ASG 원하는 · 최소를 **0**으로 둔다(`t3.medium` 시간당 약 $0.052 + IP · 디스크)
- 다 쓰면 ASG → 시작 템플릿 → IAM 역할 → SSM 매개변수 → 보안 그룹(`a301-loadtest`의 7880 · 6379 규칙 포함) 순서로 지운다
