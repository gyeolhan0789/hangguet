import { frontendMetrics } from "@/lib/monitoring/metrics";

const timedMetrics = new Set(["TTFB", "FCP", "LCP", "INP"]);
const errorKinds = new Set(["error", "unhandledrejection", "boundary"]);

export async function POST(request: Request) {
  if (process.env.A301_DEV_MONITORING !== "1") return new Response(null, { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 256) {
    return new Response(null, { status: 413 });
  }

  let event: unknown;
  try {
    event = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!event || typeof event !== "object") return new Response(null, { status: 400 });

  const payload = event as Record<string, unknown>;
  if (payload.type === "error" && errorKinds.has(String(payload.kind))) {
    frontendMetrics().errors.inc({ kind: String(payload.kind) });
  } else if (
    payload.type === "vital" &&
    timedMetrics.has(String(payload.metric)) &&
    typeof payload.value === "number" &&
    Number.isFinite(payload.value) &&
    payload.value >= 0 &&
    payload.value <= 60000
  ) {
    frontendMetrics().timings.observe({ metric: String(payload.metric) }, payload.value / 1000);
  } else {
    return new Response(null, { status: 400 });
  }

  return new Response(null, { status: 204 });
}
