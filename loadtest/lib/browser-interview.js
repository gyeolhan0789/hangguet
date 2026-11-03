// 실제 화면으로 화상 면접을 처음부터 끝까지 진행한다(k6 browser). s0-browser.js · seed/interviews.js가 같이 쓴다.
// 흐름(master 화면 기준): 로그인 → /practice/interviewer?applicationId= → 면접관 → 화상 → 장치 점검(녹음 · 들어보기 · 잘 들려요)
//   → 질문 준비 완료 → 면접 시작 → 면접방(답변 5개, 마지막 답변 뒤 자동 종료) → 결과 분석 → 결과 → 다시보기
// 가짜 마이크(media/answer.wav)는 답변 뒤 8초 침묵이라 에이전트가 7초 침묵에서 답변을 제출한다.
import { BASE_URL, PASSWORD } from "./config.js";

const PERSONA_LABEL = { COFFEE_CHAT: "개발자 커피챗", DEVIL: "악마 면접관" };

const seconds = (from) => (Date.now() - from) / 1000;

async function waitForUrl(page, pattern, timeoutSeconds) {
  const until = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < until) {
    if (pattern.test(page.url())) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/** 실패한 단계를 담아 던진다. 부르는 쪽이 화면을 캡처하고 기록한다 */
export class InterviewStepError extends Error {
  constructor(step, message) {
    super(`${step}: ${message}`);
    this.step = step;
  }
}

const LOGIN_ATTEMPTS = 2;

/** 로그인 화면이 다 그려진 뒤 입력하고, 입력값이 들어갔는지 확인한다 */
async function tryLogin(page, email) {
  // 화면을 그리는 도중(hydration 전)에 입력하면 값이 지워지거나 브라우저가 메시지 없는 오류를 던진다(11/03 동시 시작 때 5번)
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  const emailInput = page.locator("#email");
  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  await emailInput.fill(email);
  await page.locator("#password").fill(PASSWORD);
  if ((await emailInput.inputValue()) !== email) throw new Error("이메일 입력값이 지워졌다");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  if (!(await waitForUrl(page, /\/home$/, 30))) throw new Error("홈으로 가지 않았다");
}

/** 로그인해 홈까지 간다. 실패하면 한 번 더 시도한다(발생기 쪽 실패가 서버 측정에 섞이지 않게) */
export async function loginByUi(page, email) {
  for (let attempt = 1; ; attempt++) {
    try {
      await tryLogin(page, email);
      return;
    } catch (e) {
      const reason = e?.message ?? String(e);
      if (attempt >= LOGIN_ATTEMPTS) throw new InterviewStepError("로그인", reason);
      console.warn(`${email} 로그인 ${attempt}번째 실패, 다시 시도: ${reason}`);
    }
  }
}

/**
 * 로그인한 page로 화상 면접 1건을 끝까지 진행한다. 단계별 시간(초)을 돌려준다.
 * - planReadySeconds: 장치 점검 화면 도착 → "면접관이 질문을 준비했어요"(GMS PLAN + 면접관 3D 모델 받기)
 * - firstQuestionSeconds: 면접방 입장 → 첫 질문 표시(에이전트 배정 · 입장 · 질문 음성)
 * - questionGaps: 질문 n → n+1이 표시되기까지 걸린 시간들(답변 길이 약 14초 + 침묵 판정 7초 + 저장 · 다음 질문)
 * - interviewSeconds: 면접방 입장 → 결과 분석 화면(질문 5개 · 답변 5개)
 * - evaluationSeconds: 결과 분석 화면 → 결과 화면(GMS 채점 · 결과)
 * - replaySeconds: 결과 화면 → 다시보기 영상 표시(녹화 합치기)
 * 첫 질문이 FIRST_QUESTION_TIMEOUT 안에 나오지 않으면 "면접관 입장" 단계 실패로 던진다(에이전트가 새 면접을 받지 않을 때, H6)
 */
const FIRST_QUESTION_TIMEOUT = 120;

export async function runVideoInterview(page, applicationId, { persona = "COFFEE_CHAT", log = () => {} } = {}) {
  let step = "면접관 · 방식 선택";
  // 재는 대로 채운다. 중간 단계에서 실패해도 이미 잰 값은 오류에 담아 넘긴다(다시보기만 실패한 면접의 시간도 남기려고)
  const t = { sessionId: null, firstQuestionSeconds: null, questionGaps: [] };
  try {
    await page.goto(`${BASE_URL}/practice/interviewer?applicationId=${applicationId}`);
    await page.getByText(PERSONA_LABEL[persona], { exact: true }).click();
    await page.getByRole("button", { name: "다음: 면접 방식" }).click();
    await page.getByText("화상으로 할래요", { exact: true }).click();
    await page.getByRole("button", { name: "다음: 장치 점검" }).click();
    if (!(await waitForUrl(page, /\/practice\/devices\?sessionId=\d+/, 30))) throw new Error("장치 점검 화면으로 가지 않았다");
    const sessionId = page.url().match(/sessionId=(\d+)/)[1];
    t.sessionId = sessionId;
    const atDevices = Date.now();
    log(`면접 ${sessionId} 만듦`);

    step = "장치 점검";
    await page.getByRole("button", { name: "녹음하기", exact: true }).click();
    await page.getByRole("button", { name: "들어보기", exact: true }).click({ timeout: 15000 });
    await page.getByRole("button", { name: "잘 들려요", exact: true }).click({ timeout: 15000 });

    step = "질문 준비";
    await page.getByText("면접관이 질문을 준비했어요").waitFor({ timeout: 200000 });
    t.planReadySeconds = seconds(atDevices);
    await page.getByRole("button", { name: "면접 시작", exact: true }).click();
    if (!(await waitForUrl(page, new RegExp(`/interview/${sessionId}$`), 30))) throw new Error("면접방으로 가지 않았다");
    const inRoom = Date.now();

    step = "면접 진행";
    // 마지막 답변 뒤 화면이 면접을 자동으로 끝내고 결과 분석 화면을 보여 준다
    let lastSeq = 0;
    let lastSeqAt = null;
    const analyzing = page.getByText("면접관이 답변을 검토하고 있어요");
    const roomUntil = Date.now() + 20 * 60 * 1000;
    while (!(await analyzing.isVisible())) {
      if (Date.now() > roomUntil) throw new Error("20분 안에 면접이 끝나지 않았다");
      if (/\/result$/.test(page.url())) break;
      if (lastSeq === 0 && seconds(inRoom) > FIRST_QUESTION_TIMEOUT) {
        throw new InterviewStepError("면접관 입장", `${FIRST_QUESTION_TIMEOUT}초 안에 첫 질문이 나오지 않았다(면접관이 들어오지 않음)`);
      }
      // 화면이 다시 그려지는 동안 값이 잠깐 이전 값으로 보일 수 있어, 늘어날 때만 적는다
      const seq = Number(
        await page
          .locator('[role=progressbar][aria-label="질문 진행"]')
          .first()
          .getAttribute("aria-valuenow", { timeout: 1000 })
          .catch(() => 0),
      );
      if (seq > lastSeq) {
        log(`면접 ${sessionId} 질문 ${seq} (${Math.round(seconds(inRoom))}초)`);
        if (lastSeq === 0) {
          t.firstQuestionSeconds = seconds(inRoom);
        } else {
          t.questionGaps.push(seconds(lastSeqAt));
        }
        lastSeq = seq;
        lastSeqAt = Date.now();
      }
      await page.waitForTimeout(2000);
    }
    t.interviewSeconds = seconds(inRoom);

    step = "결과 분석";
    const analyzingFrom = Date.now();
    if (!(await waitForUrl(page, new RegExp(`/interview/${sessionId}/result$`), 660))) throw new Error("결과 화면으로 가지 않았다");
    await page.getByText("오늘의 성장 리뷰 보기").waitFor();
    t.evaluationSeconds = seconds(analyzingFrom);

    step = "다시보기";
    // 영상이 나오거나 "녹화를 불러오지 못했어요"(녹화 합치기 실패)가 나올 때까지 기다린다. 합치는 중이면 화면이 10초마다 다시 그린다
    const replayFrom = Date.now();
    await page.goto(`${BASE_URL}/interview/${sessionId}/replay`);
    const video = page.locator("video").first();
    const failedText = page.getByText("녹화를 불러오지 못했어요");
    const replayUntil = Date.now() + 15 * 60 * 1000;
    while (!(await video.isVisible())) {
      if (await failedText.isVisible()) throw new Error("녹화 합치기 실패(녹화를 불러오지 못했어요)");
      if (Date.now() > replayUntil) throw new Error("15분 안에 다시보기 영상이 나오지 않았다");
      await page.waitForTimeout(2000);
    }
    t.replaySeconds = seconds(replayFrom);
    return t;
  } catch (e) {
    const error = e instanceof InterviewStepError ? e : new InterviewStepError(step, String(e));
    error.sessionId = t.sessionId;
    error.timings = t;
    throw error;
  }
}
