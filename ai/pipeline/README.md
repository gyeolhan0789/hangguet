# 회사 카드 파이프라인 (MVP)

회사의 사업보고서와 인재상을 모아, 출처가 달린 회사 카드(JSON)를 만든다.

```
companies.json → ① 공시 수집 → ② 사업의 내용 추출 → ③ LLM 요약(원문 인용) → ④ 인용 검증
              → data/cards/{고유번호}.json
```

## 회사 목록

`companies.json`에 회사를 적는다. `name`은 DART에 등록된 회사명과 정확히 같아야 한다.
인재상은 채용 페이지에서 복사해 `talent_text`에, 그 페이지 주소를 `talent_url`에 넣는다.

```json
[{"name": "삼성전자", "talent_url": "채용 페이지 주소", "talent_text": "인재상 원문"}]
```

## 환경변수

`ai/.env`에 넣는다. `.env`는 git에서 제외되어 있다.

| 이름 | 내용 |
|---|---|
| `DART_API_KEY` | opendart.fss.or.kr 인증키 |
| `GMS_API_KEY` | SSAFY GMS 키 |
| `GMS_CHAT_URL` | GMS chat completions 주소 |
| `GMS_MODEL` | 모델 이름 |

## 데이터

수집한 원문은 `data/raw/`, 만든 카드는 `data/cards/`에 저장하며 둘 다 git에서 제외한다.
