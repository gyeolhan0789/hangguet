export type Theme = "light" | "dark";

const STORAGE_KEY = "hk-theme";

/**
 * 첫 페인트 전에 <html data-theme>를 정한다. 저장된 선택이 없으면 OS 설정을 따른다.
 * 루트 레이아웃 <head>에서 인라인 스크립트로 실행한다.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 이번 방문 동안만 유지한다.
  }
  return next;
}
