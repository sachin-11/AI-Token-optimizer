import "server-only";

import { type AIRequest, type Prisma, type AIProvider, type RequestStatus } from "@prisma/client";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "@/repositories/base.repository";

export type CreateAIRequestInput = {
  requestId: string;
  userId?: string;
  provider: AIProvider;
  model: string;
  endpoint: string;
  ipAddress?: string;
  userAgent?: string;
  inputCharCount?: number;
};

export type UpdateAIRequestInput = Partial<{
  status: RequestStatus;
  outputCharCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  fromCache: boolean;
  cacheType: string;
  errorCode: string;
  errorMessage: string;
}>;

export class AIRequestRepository extends BaseRepository {
  constructor() { super("AIRequest"); }

  async create(input: CreateAIRequestInput): Promise<AIRequest> {
    try {
      return await this.db.aIRequest.create({ data: input });
    } catch (e) { this.handleError(e, "create"); }
  }

  async updateByRequestId(requestId: string, input: UpdateAIRequestInput): Promise<void> {
    try {
      await this.db.aIRequest.updateMany({ where: { requestId }, data: input });
    } catch (e) { this.handleError(e, "updateByRequestId"); }
  }

  async listByUser(
    userId: string,
    params: PaginationParams & { provider?: AIProvider; status?: RequestStatus },
  ): Promise<PaginatedResult<AIRequest>> {
    const { skip, take } = this.buildPagination(params);
    const where: Prisma.AIRequestWhereInput = {
      userId,
      ...(params.provider && { provider: params.provider }),
      ...(params.status   && { status:   params.status }),
    };
    try {
      const [data, total] = await this.db.$transaction([
        this.db.aIRequest.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
        this.db.aIRequest.count({ where }),
      ]);
      return this.buildPaginatedResult(data, total, params);
    } catch (e) { this.handleError(e, "listByUser"); }
  }

  async getProviderStats(provider: AIProvider, since: Date) {
    try {
      return await this.db.aIRequest.aggregate({
        where: { provider, createdAt: { gte: since } },
        _count: { id: true },
        _sum:   { totalTokens: true, costUsd: true },
        _avg:   { latencyMs: true },
      });
    } catch (e) { this.handleError(e, "getProviderStats"); }
  }
}

let instance: AIRequestRepository | null = null;
export function getAIRequestRepository(): AIRequestRepository {
  instance ??= new AIRequestRepository();
  return instance;
}
