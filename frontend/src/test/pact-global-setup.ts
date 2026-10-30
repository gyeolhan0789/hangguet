import fs from "node:fs";

/** 지난 실행의 상호작용이 계약 파일에 남지 않게 실행 전에 계약 폴더(frontend/pacts)를 비운다(pact-js consumer 문서). */
export default function setup() {
  fs.rmSync("pacts", { recursive: true, force: true });
}
