import type { Page } from "@playwright/test";

// 연출(불 전환 · 레벨업)은 실제 시간으로 지나가 잠깐만 보인다. 보일 때를 기다려 잡는 대신,
// 페이지가 열리기 전부터 화면에 나온 것을 차례대로 적어 두고 끝난 뒤에 확인한다(시간 · 타이밍 운에 기대지 않는다).

declare global {
  interface Window {
    __screens?: string[];
  }
}

/**
 * 이 페이지에 나온 화면을 나온 차례대로 적는다. 같은 화면은 한 번만 적는다.
 * - 'status:…' : role="status"의 aria-label(예: 'N일째 달성!' 불 전환)
 * - 'dialog:…' : 대화상자의 이름(aria-labelledby가 가리키는 글, 예: 레벨업 '○○ 달성!')
 * - 'h1:…' : 페이지 제목(예: 리뷰 'N일째 연습 완료!')
 */
export async function recordScreens(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__screens = seen;
    const note = (entry: string) => {
      if (!seen.includes(entry)) seen.push(entry);
    };
    const scan = () => {
      document.querySelectorAll("[role=status][aria-label]").forEach((element) => {
        note(`status:${element.getAttribute("aria-label")}`);
      });
      document.querySelectorAll("[role=dialog][aria-labelledby]").forEach((element) => {
        const title = document.getElementById(element.getAttribute("aria-labelledby") ?? "");
        if (title?.textContent) note(`dialog:${title.textContent.trim()}`);
      });
      document.querySelectorAll("h1").forEach((element) => {
        if (element.textContent) note(`h1:${element.textContent.trim()}`);
      });
    };
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
}

/** recordScreens로 적어 둔 화면 목록 */
export const screens = (page: Page) => page.evaluate(() => window.__screens ?? []);
