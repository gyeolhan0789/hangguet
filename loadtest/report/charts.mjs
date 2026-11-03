// 보고서용 서버 지표 그래프(SVG). Grafana 대시보드 "A301 운영 서버"와 같은 질의를 테스트 서버 Prometheus에 보내 그린다.
// Grafana는 로그인이 필요하고 화면을 파일로 저장할 수 없어서, 같은 데이터 · 같은 질의로 그림을 만든다.
// 로컬 PC(레포 루트)에서 실행한다. 서버 접속은 loadtest/server/ssh.sh를 쓴다.
//   node loadtest/report/charts.mjs <시작 유닉스초> <끝 유닉스초> <출력 폴더> [단계 JSON]
//   예) node loadtest/report/charts.mjs 1793594000 1793596000 loadtest/report/img/s1 '[{"from":1793594060,"to":1793594660,"label":"5rps"}]'
// 단계를 주면 그 구간을 옅은 색으로 칠한다. Grafana 대시보드는 rate()에 5분을 쓰지만 여기서는 단계 경계가 보이도록 1분을 쓴다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Windows에서 "bash"는 WSL bash일 수 있어(경로가 달라 키를 못 찾는다) Git Bash를 직접 쓴다.
// git.exe(cmd\ 또는 mingw64\bin\)에서 위로 올라가며 Git 설치 폴더의 bin\bash.exe를 찾는다
function gitBash() {
  for (const git of execFileSync("where", ["git"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean)) {
    for (let dir = dirname(git); dir !== dirname(dir); dir = dirname(dir)) {
      const candidate = join(dir, "bin", "bash.exe");
      if (existsSync(candidate) && existsSync(join(dir, "git-bash.exe"))) return candidate;
    }
  }
  throw new Error("Git Bash를 찾지 못했다");
}
const BASH = process.platform === "win32" ? gitBash() : "bash";

const [start, end, outDir, stagesJson] = process.argv.slice(2);
if (!start || !end || !outDir) {
  console.error("사용법: node loadtest/report/charts.mjs <시작 유닉스초> <끝 유닉스초> <출력 폴더> [단계 JSON]");
  process.exit(1);
}
const stages = stagesJson ? JSON.parse(stagesJson) : [];
const STEP = 15;

const C = 'job="a301-cadvisor",name=~"a301-prod-.+"';
const short = (expr) => `label_replace(${expr}, "name", "$1", "name", "a301-prod-(.*)")`;

// 패널: Grafana 대시보드의 같은 이름 패널에서 질의를 가져왔다(rate 구간만 1분)
const PANELS = [
  {
    file: "server-cpu",
    title: "서버 CPU 사용률",
    unit: "percent",
    max: 1,
    lines: [{ dashed: 0.4, label: "기준치 40%" }],
    queries: [
      { legend: "전체", expr: '1 - avg(rate(node_cpu_seconds_total{job="a301-node",mode="idle"}[1m]))' },
      { legend: "steal", expr: 'avg(rate(node_cpu_seconds_total{job="a301-node",mode="steal"}[1m]))' },
    ],
  },
  {
    file: "container-cpu",
    title: "컨테이너별 CPU (코어, 2분 평균)",
    unit: "cores",
    top: 6,
    queries: [{ legend: "{{name}}", expr: short(`sum by (name) (rate(container_cpu_usage_seconds_total{${C}}[2m]))`) }],
  },
  {
    file: "be-requests",
    title: "BE 요청 수 / 초",
    unit: "rps",
    queries: [{ legend: "요청/초", expr: 'sum(rate(http_server_requests_seconds_count{job="a301-be"}[1m]))' }],
  },
  {
    file: "be-latency",
    title: "BE 평균 응답 시간",
    unit: "ms",
    queries: [
      {
        legend: "평균",
        scale: 1000,
        expr: 'sum(rate(http_server_requests_seconds_sum{job="a301-be"}[1m])) / sum(rate(http_server_requests_seconds_count{job="a301-be"}[1m]))',
      },
    ],
  },
  {
    file: "be-db-pool",
    title: "BE DB 연결 풀",
    unit: "count",
    queries: [
      { legend: "사용 중", expr: 'max(hikaricp_connections_active{job="a301-be"})' },
      { legend: "대기", expr: 'max(hikaricp_connections_pending{job="a301-be"})' },
      { legend: "최대", expr: 'max(hikaricp_connections_max{job="a301-be"})' },
    ],
  },
  {
    file: "db-tps",
    title: "PostgreSQL 트랜잭션 / 초",
    unit: "rps",
    queries: [{ legend: "커밋", expr: 'rate(pg_stat_database_xact_commit{job="a301-postgres",datname="a301"}[1m])' }],
  },
  {
    file: "container-memory",
    title: "컨테이너별 메모리",
    unit: "bytes",
    top: 6,
    queries: [{ legend: "{{name}}", expr: short(`max by (name) (container_memory_working_set_bytes{${C}})`) }],
  },
  {
    file: "server-network",
    title: "서버 네트워크",
    unit: "bps",
    queries: [
      {
        legend: "받기",
        expr: 'sum(rate(container_network_receive_bytes_total{job="a301-cadvisor",id="/",interface!~"lo|br-.*|docker.*|veth.*"}[1m])) * 8',
      },
      {
        legend: "보내기",
        expr: 'sum(rate(container_network_transmit_bytes_total{job="a301-cadvisor",id="/",interface!~"lo|br-.*|docker.*|veth.*"}[1m])) * 8',
      },
    ],
  },
];

function rangeQuery(expr) {
  const q = encodeURIComponent(expr);
  const url = `http://localhost:9090/api/v1/query_range?query=${q}&start=${start}&end=${end}&step=${STEP}`;
  const out = execFileSync(BASH, ["loadtest/server/ssh.sh", `docker exec a301-prod-prometheus wget -qO- '${url}'`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).data.result;
}

function series(panel) {
  const all = [];
  for (const q of panel.queries) {
    for (const r of rangeQuery(q.expr)) {
      const name = q.legend.replace(/\{\{(\w+)\}\}/g, (_, k) => r.metric[k] ?? "");
      all.push({ name, points: r.values.map(([t, v]) => [Number(t), Number(v) * (q.scale || 1)]) });
    }
  }
  if (panel.top) {
    // 구간 최대값이 큰 순으로 몇 개만 그린다(작은 것은 0 근처에 겹쳐 읽을 수 없다)
    all.sort((a, b) => Math.max(...b.points.map((p) => p[1])) - Math.max(...a.points.map((p) => p[1])));
    return all.slice(0, panel.top);
  }
  return all;
}

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4b5563"];
const STAGE_FILL = ["#e0f2fe", "#fef3c7", "#fee2e2", "#ede9fe", "#dcfce7"];

function fmt(v, unit) {
  if (unit === "percent") return `${Math.round(v * 100)}%`;
  if (unit === "bytes") return v >= 2 ** 30 ? `${(v / 2 ** 30).toFixed(1)}GB` : `${Math.round(v / 2 ** 20)}MB`;
  if (unit === "bps") return v >= 1e6 ? `${(v / 1e6).toFixed(1)}Mbps` : `${Math.round(v / 1e3)}kbps`;
  if (unit === "ms") return `${Math.round(v)}ms`;
  if (unit === "cores") return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function clock(t) {
  const d = new Date((t + 9 * 3600) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function svg(panel, data) {
  const W = 900, H = 300, L = 70, R = 20, T = 40, B = 60;
  const t0 = Number(start), t1 = Number(end);
  const values = data.flatMap((s) => s.points.map((p) => p[1])).filter(Number.isFinite);
  const peakAll = Math.max(...values, ...(panel.lines || []).map((l) => l.dashed), 0) * 1.1;
  // 메모리는 MB 단위로 딱 떨어지는 눈금을 쓴다
  const yMax = panel.max ?? (panel.unit === "bytes" ? niceMax(peakAll / 2 ** 20) * 2 ** 20 : niceMax(peakAll));
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Pretendard, 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" font-size="12">`];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${L}" y="22" font-size="15" font-weight="bold" fill="#111827">${esc(panel.title)}</text>`);
  stages.forEach((s, i) => {
    const a = Math.max(x(s.from), L), b = Math.min(x(s.to), W - R);
    if (b <= a) return;
    parts.push(`<rect x="${a}" y="${T}" width="${b - a}" height="${H - T - B}" fill="${STAGE_FILL[i % STAGE_FILL.length]}"/>`);
    parts.push(`<text x="${(a + b) / 2}" y="${T + 14}" text-anchor="middle" fill="#6b7280">${esc(s.label)}</text>`);
  });
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="#6b7280">${fmt(v, panel.unit)}</text>`);
  }
  const ticks = 8;
  for (let i = 0; i <= ticks; i++) {
    const t = t0 + ((t1 - t0) * i) / ticks;
    parts.push(`<text x="${x(t)}" y="${H - B + 16}" text-anchor="middle" fill="#6b7280">${clock(t)}</text>`);
  }
  for (const l of panel.lines || []) {
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(l.dashed)}" y2="${y(l.dashed)}" stroke="#9ca3af" stroke-dasharray="5 4"/>`);
    parts.push(`<text x="${W - R - 4}" y="${y(l.dashed) - 4}" text-anchor="end" fill="#6b7280">${esc(l.label)}</text>`);
  }
  data.forEach((s, i) => {
    const pts = s.points.filter((p) => Number.isFinite(p[1])).map((p) => `${x(p[0]).toFixed(1)},${y(Math.min(p[1], yMax)).toFixed(1)}`);
    if (pts.length) parts.push(`<polyline fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2" points="${pts.join(" ")}"/>`);
  });
  let lx = L;
  data.forEach((s, i) => {
    const peak = Math.max(...s.points.map((p) => p[1]).filter(Number.isFinite));
    const label = `${s.name} (최대 ${fmt(peak, panel.unit)})`;
    parts.push(`<rect x="${lx}" y="${H - 22}" width="10" height="10" fill="${COLORS[i % COLORS.length]}"/>`);
    parts.push(`<text x="${lx + 14}" y="${H - 13}" fill="#374151">${esc(label)}</text>`);
    lx += 24 + label.length * 7.2;
  });
  parts.push("</svg>");
  return parts.join("\n");
}

mkdirSync(outDir, { recursive: true });
for (const panel of PANELS) {
  const data = series(panel);
  writeFileSync(join(outDir, `${panel.file}.svg`), svg(panel, data));
  console.log(`${panel.file}.svg: 선 ${data.length}개`);
}
