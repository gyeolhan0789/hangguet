import { act } from "@testing-library/react";

/**
 * 이벤트가 부른 비동기 처리(목 서버 액션의 Promise 등)가 이어서 바꾸는 상태를 act 안에서 마저 반영한다.
 * fireEvent · render 같은 Testing Library 호출은 이미 act로 감싸져 있으니 다시 감싸지 말고,
 * 그 뒤에 이어지는 비동기 갱신만 이 함수로 기다린다(Testing Library no-unnecessary-act).
 */
export function flushPromises() {
  return act(async () => {});
}
