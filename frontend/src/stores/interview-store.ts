import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// S06 · S06-B 면접 화면에서 여러 컴포넌트가 나눠 쓰는 상태.
// 기준: 기획 메모 S06-E(18:3508: [면접 종료] → 종료 확인 모달) · API 명세 5.8(leveledUp은 5.8 응답에만 있어 화면이 기억한다) · 모션 메모 S06-B(18:2615: 전송 → 면접관 '생각 중' 점 3개 → 다음 질문)

interface InterviewState {
  /** S06-E 면접 종료 확인 모달이 열려 있다 */
  endOpen: boolean;
  /** 방금 답한 질문 id. 다음 질문이 올 때까지 면접관이 '생각 중'이다. 없으면 null */
  answeredQuestionId: number | null;
  /** 5.8 면접 끝내기 응답의 레벨업. 결과 분석이 끝난 뒤 S08에서 S02-L을 띄울 때 쓴다(API 명세 5.8). 모르면 null */
  leveledUp: boolean | null;
  openEnd: () => void;
  closeEnd: () => void;
  setAnsweredQuestion: (questionId: number | null) => void;
  setLeveledUp: (leveledUp: boolean | null) => void;
  /** 다른 면접 화면으로 들어올 때 처음 상태로 되돌린다. 이미 끝낸 면접(결과 분석 중)이면 레벨업은 남긴다. */
  reset: (options?: { keepLeveledUp?: boolean }) => void;
}

const initial = { endOpen: false, answeredQuestionId: null, leveledUp: null };

// 레벨업은 S06-1 · S07 · S08에서 새로고침해도 S08까지 남아야 해서 sessionStorage에 둔다(탭을 닫으면 지워진다).
// 모달 · 답한 질문은 그 화면에서만 쓰므로 남기지 않는다.
export const useInterviewStore = create<InterviewState>()(
  persist(
    (set) => ({
      ...initial,
      openEnd: () => set({ endOpen: true }),
      closeEnd: () => set({ endOpen: false }),
      setAnsweredQuestion: (answeredQuestionId) => set({ answeredQuestionId }),
      setLeveledUp: (leveledUp) => set({ leveledUp }),
      reset: (options) =>
        set(
          options?.keepLeveledUp
            ? { endOpen: initial.endOpen, answeredQuestionId: initial.answeredQuestionId }
            : initial,
        ),
    }),
    {
      name: "hankkeut:interview",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ leveledUp: state.leveledUp }),
    },
  ),
);
