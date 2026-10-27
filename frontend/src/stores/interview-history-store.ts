import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// S06 · S06-B 면접 중 히스토리: 이번 면접에서 답한 질문과 내 답변.
// 면접 중에 지난 질문 · 답변을 주는 API가 없어(웹 Swagger 5.5는 지금 질문만, 6.4 다시보기는 면접이 끝난 뒤) 화면이 낸 답변을 쌓는다.
// 새로고침해도 남도록 sessionStorage에 두고(탭을 닫으면 지워진다), 다른 면접에 들어오면 비운다(사용자 요청 2026-10-27).

export interface HistoryItem {
  seq: number;
  question: string;
  answer: string;
}

interface InterviewHistoryState {
  /** 쌓고 있는 면접. 다른 면접의 답변이 섞이지 않게 한다 */
  sessionId: number | null;
  items: HistoryItem[];
  /** 답변을 낸 질문을 더한다. 같은 질문을 다시 내면(재시도 · 다시 답하기) 마지막 답변으로 바꾼다. 답변 글이 비었으면(새로고침 뒤 자막 없이 다시 냄) 있던 글을 둔다 */
  add: (sessionId: number, item: HistoryItem) => void;
  /** 이 면접이 아니면 비운다 */
  enter: (sessionId: number) => void;
}

export const useInterviewHistoryStore = create<InterviewHistoryState>()(
  persist(
    (set) => ({
      sessionId: null,
      items: [],
      add: (sessionId, item) =>
        set((state) => {
          const items = state.sessionId === sessionId ? state.items : [];
          const before = items.find((it) => it.seq === item.seq);
          const next = item.answer || !before ? item : { ...item, answer: before.answer };
          return {
            sessionId,
            items: [...items.filter((it) => it.seq !== item.seq), next].sort(
              (a, b) => a.seq - b.seq,
            ),
          };
        }),
      enter: (sessionId) =>
        set((state) => (state.sessionId === sessionId ? state : { sessionId, items: [] })),
    }),
    {
      name: "hankkeut:interview-history",
      storage: createJSONStorage(() => sessionStorage),
      // 서버 렌더와 첫 화면이 같도록(하이드레이션 불일치 방지) 저장값은 면접 화면이 붙은 뒤 불러온다(enter 전에 rehydrate).
      skipHydration: true,
    },
  ),
);
