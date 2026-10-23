from fastapi import FastAPI

# HTTP는 상태 확인용이다. 면접 진행은 agent/, 생성·평가는 jobs/에서 별도로 실행할 예정이다.
# BE와의 작업·결과 전달은 Redis로 처리하며, 화면에서 호출하는 AI API는 추가하지 않는다.
app = FastAPI(title="A301 AI")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "UP"}
