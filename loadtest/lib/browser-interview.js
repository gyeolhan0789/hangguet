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

/** 로그인해 홈까지 간다 */
export async function loginByUi(page, email) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  if (!(await waitForUrl(page, /\/home$/, 30))) throw new InterviewStepError("로그인", "홈으로 가지 않았다");
}

/**
 * 로그인한 page로 화상 면접 1건을 끝까지 진행한다. 단계별 시간(초)을 돌려준다.
 * - planReadySeconds: 장치 점검 화면 도착 → "면접관이 질문을 준비했어요"(GMS PLAN + 면접관 3D 모델 받기)
 * - interviewSeconds: 면접방 입장 → 결과 분석 화면(질문 5개 · 답변 5개)
 * - evaluationSeconds: 결과 분석 화면 → 결과 화면(GMS 채점 · 결과)
 * - replaySeconds: 결과 화면 → 다시보기 영상 표시(녹화 합치기)
 */
export async function runVideoInterview(page, applicationId, { persona = "COFFEE_CHAT", log = () => {} } = {}) {
  let step = "면접관 · 방식 선택";
  try {
    await page.goto(`${BASE_URL}/practice/interviewer?applicationId=${applicationId}`);
    await page.getByText(PERSONA_LABEL[persona], { exact: true }).click();
    await page.getByRole("button", { name: "다음: 면접 방식" }).click();
    await page.getByText("화상으로 할래요", { exact: true }).click();
    await page.getByRole("button", { name: "다음: 장치 점검" }).click();
    if (!(await waitForUrl(page, /\/practice\/devices\?sessionId=\d+/, 30))) throw new Error("장치 점검 화면으로 가지 않았다");
    const sessionId = page.url().match(/sessionId=(\d+)/)[1];
    const atDevices = Date.now();
    log(`면접 ${sessionId} 만듦`);

    step = "장치 점검";
    await page.getByRole("button", { name: "녹음하기", exact: true }).click();
    await page.getByRole("button", { name: "들어보기", exact: true }).click({ timeout: 15000 });
    await page.getByRole("button", { name: "잘 들려요", exact: true }).click({ timeout: 15000 });

    step = "질문 준비";
    await page.getByText("면접관이 질문을 준비했어요").waitFor({ timeout: 200000 });
    const planReadySeconds = seconds(atDevices);
    await page.getByRole("button", { name: "면접 시작", exact: true }).click();
    if (!(await waitForUrl(page, new RegExp(`/interview/${sessionId}$`), 30))) throw new Error("면접방으로 가지 않았다");
    const inRoom = Date.now();

    step = "면접 진행";
    // 마지막 답변 뒤 화면이 면접을 자동으로 끝내고 결과 분석 화면을 보여 준다
    let lastSeq = 0;
    const analyzing = page.getByText("면접관이 답변을 검토하고 있어요");
    const roomUntil = Date.now() + 20 * 60 * 1000;
    while (!(await analyzing.isVisible())) {
      if (Date.now() > roomUntil) throw new Error("20분 안에 면접이 끝나지 않았다");
      if (/\/result$/.test(page.url())) break;
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
        lastSeq = seq;
      }
      await page.waitForTimeout(2000);
    }
    const interviewSeconds = seconds(inRoom);

    step = "결과 분석";
    const analyzingFrom = Date.now();
    if (!(await waitForUrl(page, new RegExp(`/interview/${sessionId}/result$`), 660))) throw new Error("결과 화면으로 가지 않았다");
    await page.getByText("오늘의 성장 리뷰 보기").waitFor();
    const evaluationSeconds = seconds(analyzingFrom);

    step = "다시보기";
    const replayFrom = Date.now();
    await page.goto(`${BASE_URL}/interview/${sessionId}/replay`);
    await page.locator("video").first().waitFor({ timeout: 900000 });
    const replaySeconds = seconds(replayFrom);

    return { sessionId, planReadySeconds, interviewSeconds, evaluationSeconds, replaySeconds };
  } catch (e) {
    throw e instanceof InterviewStepError ? e : new InterviewStepError(step, String(e));
  }
}
