/**
 * GET /api/health
 *
 * Health check endpoint for:
 * - Docker HEALTHCHECK
 * - Kubernetes liveness/readiness probes
 * - Load balancer health checks
 * - Uptime monitoring (UptimeRobot, Pingdom)
 */

import { NextRequest, NextResponse } from "next/server";
import { getHealthReport } from "@/observability/health-checker";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const detailed = req.nextUrl.searchParams.get("detailed") === "true";

  try {
    const report = await getHealthReport(detailed);
    const status = report.status === "unhealthy" ? 503 : 200;

    return NextResponse.json(report, { status });
  } catch {
    return NextResponse.json(
      { status: "unhealthy", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
