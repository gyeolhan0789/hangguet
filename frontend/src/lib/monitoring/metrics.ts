import { Counter, Histogram, Registry } from "@prometheus-io/client";

type FrontendMetrics = {
  registry: Registry;
  errors: Counter<"kind">;
  timings: Histogram<"metric">;
};

const globalMetrics = globalThis as typeof globalThis & {
  a301FrontendMetrics?: FrontendMetrics;
};

export function frontendMetrics(): FrontendMetrics {
  if (globalMetrics.a301FrontendMetrics) return globalMetrics.a301FrontendMetrics;

  const registry = new Registry();
  const errors = new Counter({
    name: "a301_fe_browser_errors_total",
    help: "Browser errors reported by the A301 frontend",
    labelNames: ["kind"] as const,
    registers: [registry],
  });
  const timings = new Histogram({
    name: "a301_fe_web_vital_seconds",
    help: "Real-user frontend Web Vitals in seconds",
    labelNames: ["metric"] as const,
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [registry],
  });

  globalMetrics.a301FrontendMetrics = { registry, errors, timings };
  return globalMetrics.a301FrontendMetrics;
}
