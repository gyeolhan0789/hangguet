// 모달 대화상자의 초점 가두기. 기준: WAI-ARIA APG Dialog (Modal) — Tab은 마지막 요소에서 처음으로,
// Shift+Tab은 처음 요소에서 마지막으로 돌고, 초점이 대화상자 밖으로 나가지 않는다.

/**
 * Tab 키를 누른 순간에 부른다. 처음 · 마지막 요소에서 반대쪽 끝으로 초점을 옮기고, 그 사이에서는 브라우저 기본 이동을 둔다.
 * 초점을 받을 요소가 없으면 아무것도 하지 않는다(막아야 하는 곳은 부르기 전에 직접 막는다).
 * @param items 대화상자 안의 초점 받을 요소(문서 순서)
 * @param container 초점을 받은 대화상자 자신. 여기서 Shift+Tab을 누르면 처음 요소에서 누른 것과 같이 마지막으로 간다
 */
export function cycleTabFocus(
  event: { shiftKey: boolean; preventDefault: () => void },
  items: readonly HTMLElement[],
  container?: HTMLElement | null,
) {
  const first: HTMLElement | undefined = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || (container != null && active === container))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
