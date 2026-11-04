# 오리 로컬 테스트

```powershell
node tools/duck-preview/server.mjs
```

`http://127.0.0.1:4173`에서 엽니다. 다른 포트는 `$env:PORT=4174`로 지정합니다.
FE에 이미 설치된 three.js와 `frontend/public/interview/duck/interviewer.glb`를
직접 사용하며 새 패키지 설치나 별도 백엔드는 필요 없습니다.

```powershell
node tools/duck-preview/verify-model.mjs
```

검증은 실제 GLB를 three.js로 불러와 다섯 동작의 채널과 발 고정을 확인합니다.
