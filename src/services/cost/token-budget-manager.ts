/**
 * Token Budget Manager
 *
 * Enforces per-user token and cost limits.
 * Uses Redis counters for real-time tracking — atomic INCR prevents races.
 *
 * Two budget types:
 * - Daily token limit   : hard limit on tokens per day
 * - Monthly cost limit  : hard limit on USD spend per month
 *
 * When budget is exhausted:
 * - Route to cheapest available model (not block entirely)
 * - If still over budget → reject with clear error message
 */

import "server-only";

import { redis } from "@/lib/redis";
import { createChildLogger } from "@/lib/logger";
import { RateLimitError } from "@/lib/errors";
import type { TokenBudget } from "@/types/cost-optimization";

const log = createChildLogger({ module: "TokenBudgetManager" });

// Default limits — override per user in DB
const DEFAULT_DAILY_TOKEN_LIMIT   = 500_000;   // 500K tokens/day
const DEFAULT_MONTHLY_COST_LIMIT  = 10.0;      // $10/month

export class TokenBudgetManager {
  /**
   * Get current budget status for a user.
   */
  async getBudget(userId: string): Promise<TokenBudget> {
    const [dailyTokens, monthlyUsd] = await Promise.all([
      this.getDailyTokenUsage(userId),
      this.getMonthlyUsdUsage(userId),
    ]);

    const dailyLimit   = DEFAULT_DAILY_TOKEN_LIMIT;
    const monthlyLimit = DEFAULT_MONTHLY_COST_LIMIT;

    const remainingTokens = Math.max(0, dailyLimit - dailyTokens);
    const remainingUsd    = Math.max(0, monthlyLimit - monthlyUsd);
    const utilizationPct  = Math.round((dailyTokens / dailyLimit) * 100);
    const isExhausted     = remainingTokens === 0 || remainingUsd <= 0;

    return {
      userId,
      dailyLimitTokens:  dailyLimit,
      monthlyLimitUsd:   monthlyLimit,
      usedTodayTokens:   dailyTokens,
      usedMonthUsd:      monthlyUsd,
      remainingTokens,
      remainingUsd,
      utilizationPct,
      isExhausted,
      willExceedWith: (tokens: number) =>
        dailyTokens + tokens > dailyLimit || monthlyUsd >= monthlyLimit,
    };
  }

  /**
   * Check budget before a request. Throws RateLimitError if exhausted.
   */
  async enforce(userId: string, estimatedTokens: number, estimatedCostUsd: number): Promise<void> {
    const budget = await this.getBudget(userId);

    if (budget.usedMonthUsd + estimatedCostUsd > budget.monthlyLimitUsd) {
      log.warn({ userId, usedMonthUsd: budget.usedMonthUsd, estimatedCostUsd }, "Monthly cost budget exceeded");
      throw new RateLimitError(86_400_000); // Retry tomorrow
    }

    if (budget.usedTodayTokens + estimatedTokens > budget.dailyLimitTokens) {
      log.warn({ userId, usedTodayTokens: budget.usedTodayTokens, estimatedTokens }, "Daily token budget exceeded");
      throw new RateLimitError(3_600_000); // Retry in 1 hour
    }
  }

  /**
   * Record actual usage after a completed request.
   */
  async recordUsage(userId: string, tokens: number, costUsd: number): Promise<void> {
    const dailyKey   = this.dailyKey(userId);
    const monthlyKey = this.monthlyKey(userId);

    try {
      const pipeline = redis.pipeline();
      pipeline.incrby(dailyKey, tokens);
      pipeline.expire(dailyKey, 86_400);                    // Expire at end of day
      pipeline.incrbyfloat(monthlyKey, costUsd);
      pipeline.expire(monthlyKey, 30 * 86_400);             // Expire after 30 days
      await pipeline.exec();
    } catch (error) {
      log.warn({ err: error, userId }, "Failed to record budget usage");
    }
  }

  /**
   * Get budget utilization as a percentage (0-100).
   * Used for UI warnings.
   */
  async getUtilizationPercent(userId: string): Promise<number> {
    const budget = await this.getBudget(userId);
    return budget.utilizationPct;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async getDailyTokenUsage(userId: string): Promise<number> {
    try {
      const val = await redis.get(this.dailyKey(userId));
      return parseInt(val ?? "0", 10);
    } catch { return 0; }
  }

  private async getMonthlyUsdUsage(userId: string): Promise<number> {
    try {
      const val = await redis.get(this.monthlyKey(userId));
      return parseFloat(val ?? "0");
    } catch { return 0; }
  }

  private dailyKey(userId: string): string {
    const date = new Date().toISOString().slice(0, 10);
    return `budget:daily:${userId}:${date}`;
  }

  private monthlyKey(userId: string): string {
    const month = new Date().toISOString().slice(0, 7);
    return `budget:monthly:${userId}:${month}`;
  }
}

let instance: TokenBudgetManager | null = null;
export function getTokenBudgetManager(): TokenBudgetManager {
  instance ??= new TokenBudgetManager();
  return instance;
}
