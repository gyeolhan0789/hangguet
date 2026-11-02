"""면접 에이전트의 Prometheus 지표.

동시 면접 용량과 외부 API 사용량(비용)을 Infra가 수집하도록 에이전트가 `/metrics`로 내보낸다.
- 면접은 LiveKit Agents가 띄운 자식 프로세스에서 진행되므로,
  지표 값은 multiprocess 모드로 파일에 기록하고 주 프로세스의 지표 서버가 모아서 응답한다
  (AgentServer prometheus_multiproc_dir).
- 진행 중인 면접 수는 LiveKit 기본 지표(lk_agents_active_job_count)를 쓰지 않고 직접 기록한다.
  기본 지표는 주 프로세스에서 기록되는데,
  주 프로세스는 multiprocess 폴더를 지정하기 전에 지표 라이브러리를 불러와
  파일에 기록하지 않기 때문이다.
- Windows에서는 LiveKit이 면접을 자식 프로세스가 아닌 스레드로 실행하므로,
  로컬 개발에서는 값이 수집되지 않는다.
- 사용자·면접 id를 라벨로 쓰면 면접 수만큼 지표가 늘어나므로,
  라벨은 값이 몇 개로 정해진 것만 사용한다.
"""

import os
import tempfile

from prometheus_client import Counter, Gauge

# Infra가 수집 대상(prometheus.yml)에 적는 포트다. 헬스체크 포트(8081)와 겹치지 않게 둔다
METRICS_PORT = 9464
METRICS_DIR = os.path.join(tempfile.gettempdir(), "a301-agent-metrics")

# 자식 프로세스마다 기록한 값을 살아 있는 프로세스끼리 더해 현재 진행 중인 면접 수로 응답한다
ACTIVE_INTERVIEWS = Gauge(
    "a301_agent_active_interviews",
    "진행 중인 면접 수",
    multiprocess_mode="livesum",
)
SONIOX_AUDIO_SECONDS = Counter(
    "a301_agent_soniox_audio_seconds",
    "Soniox STT로 전송한 음성 길이(초)",
)
ELEVENLABS_CHARACTERS = Counter(
    "a301_agent_elevenlabs_characters",
    "ElevenLabs로 합성한 글자 수",
)
JEV_REQUESTS = Counter(
    "a301_agent_jev_requests",
    "Jev 판단 요청 수",
    ["result"],
)
# 인상 판단(사진)은 답변 1초마다 호출해 리액션보다 훨씬 많으므로 비용을 따로 본다
JEV_IMAGE_REQUESTS = Counter(
    "a301_agent_jev_image_requests",
    "Jev 인상 판단(사진) 요청 수",
    ["result"],
)
