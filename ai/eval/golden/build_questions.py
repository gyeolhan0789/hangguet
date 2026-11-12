"""골든셋 질문 후보를 실제 질문 생성 경로(PLAN)로 만든다(효용지표 4.2).

- 자기소개서(cover_letters.json)마다 주장을 한 번 추출하고, 면접관 3종의 질문 5개씩을 생성한다.
  서비스도 주장을 지원서마다 한 번 추출해 면접관과 관계없이 쓰기 때문이다(AI 명세 2장).
- 결과는 plan_runs.json에 버전과 함께 남긴다. 골든셋 질문은 이 후보에서 고르며,
  다시 실행하면 질문이 바뀌므로 골든셋을 고친 뒤에는 다시 실행하지 않는다.
- GMS 접속 값(LLM_*)은 환경 변수나 저장소 루트의 .env에서 읽는다.

실행(ai 폴더): uv run python -m eval.golden.build_questions
"""

import json
import os
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.common.cover_letter import CoverLetterItem
from app.common.gms import GmsClient
from app.common.session import Persona
from app.common.settings import load_settings
from app.interview.plan.generate import extract_claims, generate_questions
from app.interview.plan.job import PROMPT_VERSION, claim_json, gms_plan_chat, question_json
from app.worker.messages import PlanJob

GOLDEN_DIR = Path(__file__).parent
ROOT_ENV = GOLDEN_DIR.parents[2] / ".env"


def read_env(path: Path) -> dict[str, str]:
    """KEY=VALUE 줄만 읽는다. 환경 변수가 이미 있으면 그 값을 우선한다."""
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                values[key.strip()] = value.strip()
    return values | dict(os.environ)


def plan_job(cover_letter: Mapping[str, Any], persona: Persona) -> PlanJob:
    return PlanJob(
        job_id=str(uuid.uuid4()),
        session_id=0,
        requested_at=datetime.now(UTC),
        company_name=cover_letter["companyName"],
        job_title=cover_letter["jobTitle"],
        cover_letter_items=tuple(
            CoverLetterItem(item["question"], item["answer"])
            for item in cover_letter["coverLetterItems"]
        ),
        persona=persona,
    )


def main() -> None:
    settings = load_settings(read_env(ROOT_ENV))
    client = GmsClient.from_settings(settings)
    chat = gms_plan_chat(lambda: client)
    cover_letters = json.loads((GOLDEN_DIR / "cover_letters.json").read_text(encoding="utf-8"))

    runs: dict[str, Any] = {}
    for cl_id, cover_letter in cover_letters.items():
        claims = extract_claims(chat, plan_job(cover_letter, Persona.COFFEE_CHAT))
        runs[cl_id] = {
            "claims": [claim_json(c) for c in claims.claims],
            "claimsModelVersion": claims.model,
            "questions": {},
        }
        for persona in Persona:
            questions = generate_questions(chat, plan_job(cover_letter, persona), claims.claims)
            runs[cl_id]["questions"][persona.value] = {
                "questions": [question_json(q) for q in questions.questions],
                "modelVersion": questions.model,
            }
            print(f"{cl_id} {persona.value}: 질문 {len(questions.questions)}개")

    output = {
        "promptVersion": PROMPT_VERSION,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "runs": runs,
    }
    (GOLDEN_DIR / "plan_runs.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
