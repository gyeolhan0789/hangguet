import { connection } from "next/server";

import { frontendMetrics } from "@/lib/monitoring/metrics";

export async function GET() {
  await connection();
  if (process.env.A301_DEV_MONITORING !== "1") return new Response(null, { status: 404 });

  const { registry } = frontendMetrics();
  return new Response(await registry.metrics(), {
    headers: { "Content-Type": registry.contentType, "Cache-Control": "no-store" },
  });
}
