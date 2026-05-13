import "server-only";

import {
  type OptimizationResult,
  type Prisma,
  type OptimizationStatus,
  type OptimizationMode,
  type OptimizationType,
  type AIProvider,
  type PromptType,
} from "@prisma/client";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "@/repositories/base.repository";

export type CreateOptimizationInput = {
  userId: string;
  requestId: string;
  promptId?: string;
  type: OptimizationType;
  mode: OptimizationMode;
  promptType: PromptType;
  provider: AIProvider;
  model: string;
  originalPrompt: string;
};

export type UpdateOptimizationInput = Partial<{
  status: OptimizationStatus;
  optimizedPrompt: string;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  compressionRatio: number;
  semanticScore: number;
  meaningPreservation: number;
  validationPassed: boolean;
  qualityScore: number;
  tokenEfficiencyScore: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  savedCostUsd: number;
  processingTimeMs: number;
  fromCache: boolean;
  cacheType: string;
  agentTrace: Prisma.InputJsonValue;
  errorMessage: string;
  retryCount: number;
}>;

export class OptimizationResultRepository extends BaseRepository {
  constructor() { super("OptimizationResult"); }

  async findById(id: string): Promise<OptimizationResult | null> {
    try {
      return await this.db.optimizationResult.findFirst({ where: { id, deletedAt: null } });
    } catch (e) { this.handleError(e, "findById"); }
  }

  async findByRequestId(requestId: string): Promise<OptimizationResult | null> {
    try {
      return await this.db.optimizationResult.findFirst({ where: { requestId, deletedAt: null } });
    } catch (e) { this.handleError(e, "findByRequestId"); }
  }

  async findLatestCompletedByInputHash(inputHash: string): Promise<OptimizationResult | null> {
    try {
      return await this.db.optimizationResult.findFirst({
        where: {
          inputHash,
          status:   "COMPLETED",
          deletedAt: null,
        },
        orderBy: { updatedAt: "desc" },
      });
    } catch (e) {
      this.handleError(e, "findLatestCompletedByInputHash");
    }
  }

  async createCompletedOptimization(input: {
    userId: string;
    requestId: string;
    inputHash: string;
    model: string;
    mode: OptimizationMode;
    originalPrompt: string;
    optimizedPrompt: string;
    savedTokens: number;
    compressionRatio: number;
    savedCostUsd: number;
    qualityScore: number;
    processingTimeMs: number;
    agentTrace: Prisma.InputJsonValue | null;
  }): Promise<OptimizationResult> {
    try {
      return await this.db.optimizationResult.create({
        data: {
          userId: input.userId,
          requestId: input.requestId,
          inputHash: input.inputHash,
          type: "FULL_OPTIMIZATION",
          mode: input.mode,
          promptType: "GENERAL",
          provider: "OPENAI",
          model: input.model,
          originalPrompt: input.originalPrompt,
          optimizedPrompt: input.optimizedPrompt,
          status: "COMPLETED",
          savedTokens: input.savedTokens,
          compressionRatio: input.compressionRatio,
          savedCostUsd: input.savedCostUsd,
          qualityScore: input.qualityScore,
          processingTimeMs: input.processingTimeMs,
          agentTrace: input.agentTrace ?? undefined,
          fromCache: false,
        },
      });
    } catch (e) {
      this.handleError(e, "createCompletedOptimization");
    }
  }

  async create(input: CreateOptimizationInput): Promise<OptimizationResult> {
    try {
      return await this.db.optimizationResult.create({ data: input });
    } catch (e) { this.handleError(e, "create"); }
  }

  async update(id: string, input: UpdateOptimizationInput): Promise<OptimizationResult> {
    try {
      return await this.db.optimizationResult.update({ where: { id }, data: input });
    } catch (e) { this.handleError(e, "update"); }
  }

  async updateByRequestId(requestId: string, input: UpdateOptimizationInput): Promise<OptimizationResult> {
    try {
      return await this.db.optimizationResult.update({ where: { requestId }, data: input });
    } catch (e) { this.handleError(e, "updateByRequestId"); }
  }

  async softDelete(id: string, userId: string): Promise<void> {
    try {
      await this.db.optimizationResult.updateMany({
        where: { id, userId },
        data: { deletedAt: new Date() },
      });
    } catch (e) { this.handleError(e, "softDelete"); }
  }

  async listByUser(
    userId: string,
    params: PaginationParams & {
      status?: OptimizationStatus;
      type?: OptimizationType;
      model?: string;
    },
  ): Promise<PaginatedResult<OptimizationResult>> {
    const { skip, take } = this.buildPagination(params);
    const where: Prisma.OptimizationResultWhereInput = {
      userId,
      deletedAt: null,
      ...(params.status && { status: params.status }),
      ...(params.type   && { type:   params.type }),
      ...(params.model  && { model:  params.model }),
    };
    try {
      const [data, total] = await this.db.$transaction([
        this.db.optimizationResult.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
        this.db.optimizationResult.count({ where }),
      ]);
      return this.buildPaginatedResult(data, total, params);
    } catch (e) { this.handleError(e, "listByUser"); }
  }

  async getAggregateStats(userId: string, since?: Date) {
    try {
      return await this.db.optimizationResult.aggregate({
        where: { userId, deletedAt: null, status: "COMPLETED", ...(since && { createdAt: { gte: since } }) },
        _count: { id: true },
        _sum:   { savedTokens: true, savedCostUsd: true },
        _avg:   { compressionRatio: true, qualityScore: true, semanticScore: true },
      });
    } catch (e) { this.handleError(e, "getAggregateStats"); }
  }
}

let instance: OptimizationResultRepository | null = null;
export function getOptimizationResultRepository(): OptimizationResultRepository {
  instance ??= new OptimizationResultRepository();
  return instance;
}
