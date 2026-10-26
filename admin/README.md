# 한끗 관리 페이지

관리자용 웹(React + Vite, 추가 라이브러리 없음). 화면은 Figma 백오피스-디자인(A01 로그인 · A00 홈 · A02 공지 · A03 스트릭 유지권 배포 · A04 문의)을 따른다.
API는 백엔드 `8. 관리자`(`/api/v1/admin/**`)를 쓴다.

## 실행

```bash
npm install
API_PROXY_TARGET=http://localhost:8080 npm run dev
```

- 개발 서버는 `http://localhost:5174/admin/`에서 열리고, `/be/api` 요청에서 `/be`를 떼어 `API_PROXY_TARGET`(기본 `http://localhost:8080`)의 백엔드로 넘긴다.
- 관리자 계정은 백엔드를 띄울 때 환경 변수 `ADMIN_LOGIN_ID` · `ADMIN_PASSWORD` · `ADMIN_NAME`으로 만든다(가입 API 없음).
- 같은 관리자 아이디가 이미 있으면 기동 시 비밀번호를 덮어쓰지 않는다. 비밀번호 변경은 별도 절차가 필요하다.
- 검사: `npm run build`(타입 검사 포함) · `npm run lint`

## 개발 서버 배포

- GitLab CI/CD Variables에 `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD`를 등록한다. 앱 Compose는 전체 서비스를 읽으므로 Environment scope는 `dev/*`로 둔다. 비밀번호는 Masked로 설정한다. `develop`이 보호 브랜치라면 Protected도 적용한다. `ADMIN_NAME`은 생략 시 `운영자`다.
- `backend/` 또는 `deploy/dev/compose.yml` 변경이 `develop`에 반영되면 `be-deploy`가 관리 계정을 만든다. 이미 같은 아이디가 있으면 새로 만들지 않는다.
- `admin/` 또는 `deploy/dev/admin/` 변경이 `develop`에 반영되면 `admin-deploy`가 `a301-dev-admin`을 빌드하고 실행한다. 그 외 `develop` 파이프라인에서는 수동 실행할 수 있다.
- Admin 컨테이너는 `server_public-network`에만 연결한다. 외부 Nginx 설정에는 `deploy/dev/nginx.conf.example`의 `/admin/` 라우트를 한 번 반영하고 `nginx -t` 후 reload한다. CI는 외부 Nginx 설정을 자동 수정하지 않는다.
- 접속 주소는 `https://hangguet.yobistory.com/admin/`이다. API는 같은 호스트의 `/be/api/v1/admin/**`로 호출한다.
