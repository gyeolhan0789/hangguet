/**
 * 테스트가 끝나는 시점을 정하는 Promise. 경쟁 상황(응답 순서 · 기다리는 중 다시 누르기 · 언마운트)을
 * 실제 시간에 기대지 않고 resolve · reject 순서로 재현한다.
 */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
