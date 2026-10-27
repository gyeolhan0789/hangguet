import { describe, expect, it } from "vitest";

import { SWAGGER_EXAMPLE_COUNT, swaggerExamples } from "./swagger-examples";

// 타입이 맞는지는 tsc가 swagger-examples.ts를 검사해 확인한다(예시 하나라도 어긋나면 tsc 실패).
// 여기서는 생성된 예시가 빠짐없이 들어 있는지만 본다. 웹 Swagger가 바뀌면 `npm run types:examples`로 다시 만든다.
describe("웹 Swagger 예시 ↔ src/types/api", () => {
  it("요청 · 응답 예시를 모두 담고 있다", () => {
    expect(swaggerExamples).toHaveLength(SWAGGER_EXAMPLE_COUNT);
    expect(SWAGGER_EXAMPLE_COUNT).toBeGreaterThan(100);
  });
});
