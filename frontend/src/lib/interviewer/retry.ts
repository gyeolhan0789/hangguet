// 면접관 모델 받기 재시도. 시간이 아니라 실패 상태로 다시 할지 정한다.
// 기준: 사용자 결정(2026-10-22: 큰 파일이라 시간 제한 없이 상태로 판단, 자동 재시도 최대 5번)
// · Google Cloud 재시도 전략(지수 백오프 + 지터: 다시 할 때마다 간격을 두 배로, 여러 사용자가 한꺼번에 몰리지 않게 무작위로 흩뜨린다)
//   https://docs.cloud.google.com/model-armor/retry-strategy
// · 일반 관례: 네트워크 오류 · 429 · 5xx만 다시 하고, 404 같은 4xx와 파일 해석 실패는 다시 해도 같으므로 바로 실패로 본다

/** 자동으로 다시 하는 최대 횟수(처음 한 번은 빼고) */
export const MAX_RETRIES = 5;
/** 첫 재시도 간격(ms). 1 → 2 → 4 → 8 → 16초로 두 배씩 늘린다 */
export const BASE_DELAY_MS = 1000;

/** 상태 코드를 담은 받기 실패(JSON 파일 등). three FileLoader의 HttpError는 response.status를 갖는다 */
export class LoadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** offline 다시 연결되면 이어서(횟수 안 셈) · retryable 간격을 두고 다시 · fatal 바로 실패 */
export type FailureKind = "offline" | "retryable" | "fatal";

function statusOf(error: unknown): number | null {
  if (error instanceof LoadError) return error.status;
  const response = (error as { response?: { status?: unknown } } | null)?.response;
  return typeof response?.status === "number" ? response.status : null;
}

/** 실패를 다시 할지 판단한다. online은 지금 브라우저가 온라인인지 */
export function classifyFailure(error: unknown, online: boolean): FailureKind {
  if (!online) return "offline";
  const status = statusOf(error);
  if (status !== null) return status === 429 || status >= 500 ? "retryable" : "fatal";
  // 응답 없이 실패한 요청(연결 끊김 · 거부)은 fetch가 TypeError를 던진다. 파일 해석 실패 등 그 밖의 오류는 다시 해도 같다.
  return error instanceof TypeError ? "retryable" : "fatal";
}

/** retry번째(0부터) 재시도 전에 기다릴 시간. random은 0~1 */
export const backoffDelay = (retry: number, random: number) =>
  BASE_DELAY_MS * 2 ** retry + random * BASE_DELAY_MS;

/** 재시도에 쓰는 브라우저 기능. 테스트에서 바꿔 끼운다 */
export interface RetryEnv {
  isOnline: () => boolean;
  /** 다시 온라인이 될 때까지 기다린다 */
  waitOnline: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const browserRetryEnv: RetryEnv = {
  isOnline: () => navigator.onLine,
  waitOnline: () =>
    new Promise((resolve) => window.addEventListener("online", () => resolve(), { once: true })),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/**
 * task를 실패 상태에 따라 다시 한다. 오프라인이면 횟수를 쓰지 않고 다시 연결될 때까지 기다렸다가 다시 하고,
 * 다시 할 만한 실패는 간격을 늘려 가며 최대 MAX_RETRIES번, 그 밖의 실패는 바로 던진다.
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  env: RetryEnv = browserRetryEnv,
): Promise<T> {
  let retries = 0;
  for (;;) {
    try {
      return await task();
    } catch (error) {
      const kind = classifyFailure(error, env.isOnline());
      if (kind === "fatal") throw error;
      if (kind === "offline") {
        await env.waitOnline();
        continue;
      }
      if (retries >= MAX_RETRIES) throw error;
      await env.sleep(backoffDelay(retries, env.random()));
      retries++;
    }
  }
}
