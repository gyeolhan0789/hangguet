# 한끗 관리 페이지

관리자용 웹(React + Vite, 추가 라이브러리 없음). 화면은 Figma 백오피스-디자인(A01 로그인 · A00 홈 · A03 스트릭 유지권 배포)을 따른다.
API는 백엔드 `8. 관리자`(`/api/v1/admin/**`)를 쓴다.

## 실행

```bash
npm install
API_PROXY_TARGET=http://localhost:8080 npm run dev
```

- 개발 서버는 `http://localhost:5174`에서 열리고, `/api` 요청을 `API_PROXY_TARGET`(기본 `http://localhost:8080`)의 백엔드로 넘긴다.
- 관리자 계정은 백엔드를 띄울 때 환경 변수 `ADMIN_LOGIN_ID` · `ADMIN_PASSWORD` · `ADMIN_NAME`으로 만든다(가입 API 없음).
- 검사: `npm run build`(타입 검사 포함) · `npm run lint`
