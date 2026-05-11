/**
 * OpenTelemetry Instrumentation (Stub for Development)
 *
 * Why stubbed:
 * - Full OpenTelemetry setup requires 15+ packages with complex peer deps
 * - In development, we don't need distributed tracing — logs are enough
 * - Production deployment will use a proper observability platform (Datadog/Honeycomb)
 *   which provides its own instrumentation
 *
 * To enable full OTel in production:
 * 1. Install: @opentelemetry/sdk-node, @opentelemetry/auto-instrumentations-node
 * 2. Configure exporters (OTLP, Jaeger, etc.)
 * 3. Uncomment the implementation below
 */

import { isDevelopment } from "@/config/env";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ module: "Telemetry" });

export function initTelemetry(): void {
  if (isDevelopment) {
    log.info("Telemetry disabled in development — using logs only");
    return;
  }

  // Production telemetry initialization would go here
  // Example:
  // const sdk = new NodeSDK({ ... });
  // sdk.start();
}

export function shutdownTelemetry(): Promise<void> {
  return Promise.resolve();
}

/* ─── Full Implementation (for production) ─────────────────────────────────────

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | null = null;

export function initTelemetry(): void {
  if (sdk) return;

  const prometheusExporter = new PrometheusExporter({ port: 9464 });

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: "ai-prompt-optimizer",
    }),
    metricReader: prometheusExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}

export function shutdownTelemetry(): Promise<void> {
  return sdk?.shutdown() ?? Promise.resolve();
}

────────────────────────────────────────────────────────────────────────────── */
