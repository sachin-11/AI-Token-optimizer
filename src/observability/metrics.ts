/**
 * Metrics Registry
 *
 * In-process Prometheus-compatible metrics using a lightweight counter/histogram
 * implementation that works without the full OTel SDK.
 *
 * Why not full OTel metrics SDK here:
 * - OTel SDK has 15+ peer deps that cause Edge/webpack issues
 * - For most deployments, structured logs + this registry is sufficient
 * - The /api/metrics endpoint exposes Prometheus text format
 * - Full OTel can be layered on top in production via the collector
 *
 * Metric types:
 * - Counter   : monotonically increasing (requests, errors, tokens)
 * - Gauge     : current value (active connections, queue depth)
 * - Histogram : distribution (latency, token counts)
 */

import "server-only";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabelSet {
  [key: string]: string | number;
}

interface CounterEntry {
  type: "counter";
  help: string;
  values: Map<string, { labels: LabelSet; value: number }>;
}

interface GaugeEntry {
  type: "gauge";
  help: string;
  values: Map<string, { labels: LabelSet; value: number }>;
}

interface HistogramEntry {
  type: "histogram";
  help: string;
  buckets: number[];
  values: Map<string, { labels: LabelSet; counts: number[]; sum: number; count: number }>;
}

type MetricEntry = CounterEntry | GaugeEntry | HistogramEntry;

// ─── Registry ─────────────────────────────────────────────────────────────────

class MetricsRegistry {
  private readonly metrics = new Map<string, MetricEntry>();

  // ── Counter ────────────────────────────────────────────────────────────────

  registerCounter(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { type: "counter", help, values: new Map() });
    }
  }

  inc(name: string, labels: LabelSet = {}, amount = 1): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "counter") return;
    const key = labelKey(labels);
    const existing = metric.values.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      metric.values.set(key, { labels, value: amount });
    }
  }

  // ── Gauge ──────────────────────────────────────────────────────────────────

  registerGauge(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { type: "gauge", help, values: new Map() });
    }
  }

  set(name: string, value: number, labels: LabelSet = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "gauge") return;
    const key = labelKey(labels);
    metric.values.set(key, { labels, value });
  }

  // ── Histogram ──────────────────────────────────────────────────────────────

  registerHistogram(name: string, help: string, buckets: number[]): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { type: "histogram", help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() });
    }
  }

  observe(name: string, value: number, labels: LabelSet = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "histogram") return;
    const key = labelKey(labels);
    const existing = metric.values.get(key);
    if (existing) {
      existing.sum += value;
      existing.count += 1;
      for (let i = 0; i < metric.buckets.length; i++) {
        if (value <= metric.buckets[i]!) existing.counts[i]! += 1;
      }
    } else {
      const counts = metric.buckets.map((b) => (value <= b ? 1 : 0));
      metric.values.set(key, { labels, counts, sum: value, count: 1 });
    }
  }

  // ── Prometheus Text Format ─────────────────────────────────────────────────

  toPrometheusText(): string {
    const lines: string[] = [];

    for (const [name, metric] of this.metrics) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      if (metric.type === "counter" || metric.type === "gauge") {
        for (const { labels, value } of metric.values.values()) {
          lines.push(`${name}${formatLabels(labels)} ${value}`);
        }
      } else if (metric.type === "histogram") {
        for (const { labels, counts, sum, count } of metric.values.values()) {
          for (let i = 0; i < metric.buckets.length; i++) {
            const bucketLabels = { ...labels, le: String(metric.buckets[i]) };
            lines.push(`${name}_bucket${formatLabels(bucketLabels)} ${counts[i] ?? 0}`);
          }
          lines.push(`${name}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${count}`);
          lines.push(`${name}_sum${formatLabels(labels)} ${sum}`);
          lines.push(`${name}_count${formatLabels(labels)} ${count}`);
        }
      }
    }

    return lines.join("\n") + "\n";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelKey(labels: LabelSet): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

function formatLabels(labels: LabelSet): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const inner = entries.map(([k, v]) => `${k}="${v}"`).join(",");
  return `{${inner}}`;
}

// ─── Singleton Registry ───────────────────────────────────────────────────────

export const registry = new MetricsRegistry();

// ─── Register All Platform Metrics ───────────────────────────────────────────

// HTTP
registry.registerCounter("http_requests_total",        "Total HTTP requests");
registry.registerCounter("http_errors_total",          "Total HTTP errors");
registry.registerHistogram("http_request_duration_ms", "HTTP request duration in ms",
  [10, 50, 100, 250, 500, 1000, 2500, 5000]);

// AI Provider
registry.registerCounter("ai_requests_total",          "Total AI provider requests");
registry.registerCounter("ai_errors_total",            "Total AI provider errors");
registry.registerCounter("ai_tokens_total",            "Total tokens processed");
registry.registerHistogram("ai_latency_ms",            "AI provider latency in ms",
  [100, 500, 1000, 2000, 5000, 10000, 30000]);
registry.registerGauge("ai_tokens_saved_total",        "Cumulative tokens saved by optimization");

// Optimization Workflow
registry.registerCounter("optimization_total",         "Total optimization runs");
registry.registerCounter("optimization_errors_total",  "Total optimization failures");
registry.registerHistogram("optimization_duration_ms", "Optimization workflow duration in ms",
  [500, 1000, 2000, 5000, 10000, 30000, 60000]);
registry.registerHistogram("compression_ratio",        "Compression ratio distribution",
  [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);

// Cache
registry.registerCounter("cache_hits_total",           "Total cache hits");
registry.registerCounter("cache_misses_total",         "Total cache misses");
registry.registerGauge("cache_hit_rate",               "Current cache hit rate (0-1)");

// Queue
registry.registerGauge("queue_depth",                  "Current BullMQ queue depth");
registry.registerCounter("queue_jobs_total",           "Total jobs processed");
registry.registerCounter("queue_failures_total",       "Total job failures");
