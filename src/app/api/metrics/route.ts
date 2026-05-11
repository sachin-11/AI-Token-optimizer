/**
 * GET /api/metrics
 *
 * Prometheus text format metrics endpoint.
 * Scraped by Prometheus every 15s (configured in docker/prometheus/prometheus.yml).
 *
 * Protected by API secret key — not exposed publicly.
 */

import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/observability/metrics";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Protect metrics endpoint
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  const expectedKey = process.env.API_SECRET_KEY;

  if (expectedKey && apiKey !== expectedKey) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const metricsText = registry.toPrometheusText();

  return new NextResponse(metricsText, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
    },
  });
}
