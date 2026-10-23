import { afterEach, describe, expect, it, vi } from "vitest";

import { frontendMetrics } from "@/lib/monitoring/metrics";

import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("개발 서버 FE 계측", () => {
  it("개발 서버 설정이 꺼져 있으면 수집하지 않는다", async () => {
    vi.stubEnv("A301_DEV_MONITORING", "0");
    const response = await POST(
      new Request("http://localhost/api/monitoring/event", {
        method: "POST",
        body: JSON.stringify({ type: "error", kind: "error" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("허용한 오류와 Web Vital만 집계한다", async () => {
    vi.stubEnv("A301_DEV_MONITORING", "1");
    const send = (body: object) =>
      POST(
        new Request("http://localhost/api/monitoring/event", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );

    expect((await send({ type: "error", kind: "error" })).status).toBe(204);
    expect((await send({ type: "vital", metric: "LCP", value: 2500 })).status).toBe(204);
    expect((await send({ type: "vital", metric: "unknown", value: 1 })).status).toBe(400);

    const text = await frontendMetrics().registry.metrics();
    expect(text).toContain('a301_fe_browser_errors_total{kind="error"}');
    expect(text).toContain('a301_fe_web_vital_seconds_count{metric="LCP"}');
    expect(text).not.toContain('metric="unknown"');
  });
});
