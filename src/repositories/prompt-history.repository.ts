import "server-only";

import { type PromptHistory, type Prisma, type PromptType } from "@prisma/client";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "@/repositories/base.repository";

export type CreatePromptInput = {
  userId: string;
  originalContent: string;
  optimizedContent?: string;
  title?: string;
  tags?: string[];
  promptType?: PromptType;
  originalTokenCount?: number;
  optimizedTokenCount?: number;
  compressionRatio?: number;
  parentId?: string;
};

export type UpdatePromptInput = Partial<
  Pick<PromptHistory, "title" | "tags" | "optimizedContent" | "optimizedTokenCount" | "compressionRatio">
>;

export class PromptHistoryRepository extends BaseRepository {
  constructor() { super("PromptHistory"); }

  async findById(id: string, userId: string): Promise<PromptHistory | null> {
    try {
      return await this.db.promptHistory.findFirst({
        where: { id, userId, deletedAt: null },
      });
    } catch (e) { this.handleError(e, "findById"); }
  }

  async create(input: CreatePromptInput): Promise<PromptHistory> {
    try {
      // Auto-increment version if this is a new version of an existing prompt
      let version = 1;
      if (input.parentId) {
        const parent = await this.db.promptHistory.findUnique({ where: { id: input.parentId } });
        version = (parent?.version ?? 0) + 1;
      }
      return await this.db.promptHistory.create({ data: { ...input, version } });
    } catch (e) { this.handleError(e, "create"); }
  }

  async update(id: string, userId: string, input: UpdatePromptInput): Promise<PromptHistory> {
    try {
      return await this.db.promptHistory.update({
        where: { id },
        data: { ...input, updatedAt: new Date() },
      });
    } catch (e) { this.handleError(e, "update"); }
  }

  async softDelete(id: string, userId: string): Promise<void> {
    try {
      await this.db.promptHistory.updateMany({
        where: { id, userId },
        data: { deletedAt: new Date() },
      });
    } catch (e) { this.handleError(e, "softDelete"); }
  }

  async listByUser(
    userId: string,
    params: PaginationParams & { promptType?: PromptType; search?: string },
  ): Promise<PaginatedResult<PromptHistory>> {
    const { skip, take } = this.buildPagination(params);
    const where: Prisma.PromptHistoryWhereInput = {
      userId,
      deletedAt: null,
      parentId: null, // Only top-level prompts (not versions)
      ...(params.promptType && { promptType: params.promptType }),
      ...(params.search && {
        OR: [
          { title:           { contains: params.search, mode: "insensitive" } },
          { originalContent: { contains: params.search, mode: "insensitive" } },
        ],
      }),
    };
    try {
      const [data, total] = await this.db.$transaction([
        this.db.promptHistory.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
        this.db.promptHistory.count({ where }),
      ]);
      return this.buildPaginatedResult(data, total, params);
    } catch (e) { this.handleError(e, "listByUser"); }
  }

  async getVersionHistory(promptId: string, userId: string): Promise<PromptHistory[]> {
    try {
      // Walk the version chain
      const root = await this.db.promptHistory.findFirst({
        where: { id: promptId, userId, deletedAt: null },
      });
      if (!root) return [];

      return this.db.promptHistory.findMany({
        where: {
          userId,
          deletedAt: null,
          OR: [{ id: promptId }, { parentId: promptId }],
        },
        orderBy: { version: "asc" },
      });
    } catch (e) { this.handleError(e, "getVersionHistory"); }
  }
}

let instance: PromptHistoryRepository | null = null;
export function getPromptHistoryRepository(): PromptHistoryRepository {
  instance ??= new PromptHistoryRepository();
  return instance;
}
