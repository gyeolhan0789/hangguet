// 화면과 서버 액션이 같이 쓰는 안내 문구. axios 등 서버 전용 모듈을 불러오지 않아 클라이언트 컴포넌트도 쓸 수 있다.

/** 서버에 닿지 못했거나 응답 형식을 모를 때 보여 줄 문구(mock 500 INTERNAL_ERROR detail과 같다) */
export const RETRY_LATER = "잠시 후 다시 시도해 주세요.";
