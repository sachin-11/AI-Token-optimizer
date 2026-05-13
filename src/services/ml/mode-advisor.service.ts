// Mode Advisor Service
// Recommends OptimizationMode using an ONNX gradient-boosting model (when available).
// Falls back to rule-based logic when model file is not present.
// Model file path: src/services/ml/models/mode-advisor.onnx
// See src/services/ml/training/train_mode_advisor.py for training script.

import "server-only";

import path from "path";
import fs from "fs";
import { createChildLogger } from "@/lib/logger";
import { OptimizationMode, PromptType } from "@/types/compression";
import type { TokenAnalysisOutput } from "@/types/agent";

const log = createChildLogger({ module: "ModeAdvisor" });

const MODEL_PATH = path.join(process.cwd(), "src/services/ml/models/mode-advisor.onnx");

// Feature vector indices (must match Python training script)
// [tokenCount, urgencyOrdinal, promptType_0..6, provider_0..2]
// Total: 12 features
const URGENCY_MAP: Record<string, number> = {
  none: 0, low: 1, medium: 2, high: 3, critical: 4,
};
const PROMPT_TYPE_IDX: Record<PromptType, number> = {
  [PromptType.GENERAL]: 0,
  [PromptType.CODING]: 1,
  [PromptType.AGENT]: 2,
  [PromptType.SYSTEM]: 3,
  [PromptType.INSTRUCTION]: 4,
  [PromptType.TECHNICAL]: 5,
  [PromptType.CONVERSATIONAL]: 6,
};
const MODE_LABELS: OptimizationMode[] = [
  OptimizationMode.SAFE,
  OptimizationMode.BALANCED,
  OptimizationMode.AGGRESSIVE,
];

export interface ModeAdvice {
  mode: OptimizationMode;
  confidence: number;     // 0-1
  source: "onnx_model" | "rule_based";
}

export class ModeAdvisorService {
  // Lazily loaded ONNX session — null if model not installed
  private session: unknown = null;
  private sessionLoadAttempted = false;

  /**
   * Recommend an OptimizationMode given token analysis results.
   * When ONNX model is available: uses ML inference.
   * When model is missing: rule-based fallback (identical logic to token-analyzer.node.ts).
   */
  async advise(
    tokenAnalysis: TokenAnalysisOutput,
    promptType: PromptType,
    requestedMode: OptimizationMode,
  ): Promise<ModeAdvice> {
    // Try ONNX model first
    const mlResult = await this.tryOnnxInference(tokenAnalysis, promptType);
    if (mlResult) return mlResult;

    // Rule-based fallback
    return {
      mode: this.ruleBasedMode(tokenAnalysis, requestedMode),
      confidence: 1.0,
      source: "rule_based",
    };
  }

  /**
   * Attempt ONNX inference. Returns null if model not loaded or on any error.
   */
  private async tryOnnxInference(
    analysis: TokenAnalysisOutput,
    promptType: PromptType,
  ): Promise<ModeAdvice | null> {
    const session = await this.loadSession();
    if (!session) return null;

    try {
      // Build 12-element feature vector
      const features = new Float32Array(12);
      // Feature 0: normalized token count (divide by 8000 max)
      features[0] = Math.min(analysis.originalTokenCount / 8000, 1.0);
      // Feature 1: urgency ordinal (0-4)
      features[1] = (URGENCY_MAP[analysis.compressionUrgency] ?? 0) / 4;
      // Features 2-8: one-hot prompt type
      const typeIdx = PROMPT_TYPE_IDX[promptType] ?? 0;
      features[2 + typeIdx] = 1;
      // Features 9-11: context window utilization buckets
      const util = analysis.contextWindowAnalysis.utilizationPercent / 100;
      features[9]  = util < 0.5 ? 1 : 0;
      features[10] = util >= 0.5 && util < 0.8 ? 1 : 0;
      features[11] = util >= 0.8 ? 1 : 0;

      // Dynamic import — onnxruntime-node is optional
      const ort = await import("onnxruntime-node");
      const tensor = new ort.Tensor("float32", features, [1, 12]);
      const s = session as Awaited<ReturnType<typeof ort.InferenceSession.create>>;
      const output = await s.run({ features: tensor });

      const probsKey = Object.keys(output)[0] ?? "probabilities";
      const probs = output[probsKey]?.data as Float32Array | undefined;
      if (!probs || probs.length < 3) return null;

      // Argmax
      let bestIdx = 0;
      for (let i = 1; i < 3; i++) {
        if ((probs[i] ?? 0) > (probs[bestIdx] ?? 0)) bestIdx = i;
      }
      const mode = MODE_LABELS[bestIdx] ?? OptimizationMode.BALANCED;
      const confidence = Number((probs[bestIdx] ?? 0).toFixed(4));

      log.debug({ mode, confidence }, "ONNX mode advisor inference");
      return { mode, confidence, source: "onnx_model" };
    } catch (error) {
      log.warn({ err: error }, "ONNX inference failed — using rule-based fallback");
      return null;
    }
  }

  private async loadSession(): Promise<unknown> {
    if (this.sessionLoadAttempted) return this.session;
    this.sessionLoadAttempted = true;

    if (!fs.existsSync(MODEL_PATH)) {
      log.debug({ path: MODEL_PATH }, "ONNX mode advisor model not found — rule-based mode active");
      return null;
    }

    try {
      const ort = await import("onnxruntime-node");
      this.session = await ort.InferenceSession.create(MODEL_PATH);
      log.info({ path: MODEL_PATH }, "ONNX mode advisor model loaded");
    } catch (error) {
      log.warn({ err: error }, "Failed to load ONNX model — install onnxruntime-node to enable ML mode selection");
      this.session = null;
    }

    return this.session;
  }

  private ruleBasedMode(
    analysis: TokenAnalysisOutput,
    requestedMode: OptimizationMode,
  ): OptimizationMode {
    if (analysis.compressionUrgency === "critical") return OptimizationMode.AGGRESSIVE;
    if (analysis.compressionUrgency === "high" && requestedMode === OptimizationMode.SAFE) {
      return OptimizationMode.BALANCED;
    }
    if (analysis.originalTokenCount < 100) return OptimizationMode.SAFE;
    return requestedMode;
  }
}

let instance: ModeAdvisorService | null = null;
export function getModeAdvisor(): ModeAdvisorService {
  instance ??= new ModeAdvisorService();
  return instance;
}
