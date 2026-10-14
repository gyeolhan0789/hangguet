from fastapi import FastAPI

app = FastAPI(title="A301 AI")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "UP"}
