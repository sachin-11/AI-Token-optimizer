import "server-only";

import { type PromptType } from "@prisma/client";
import { getPromptHistoryRepository, type CreatePromptInput, type UpdatePromptInput } from "@/repositories/prompt-history.repository";
import { type PaginationParams } from "@/repositories/base.repository";
import { NotFoundError } from "@/lib/errors";

const repo = () => getPromptHistoryRepository();

export const PromptHistoryService = {
  async getById(id: string, userId: string) {
    const prompt = await repo().findById(id, userId);
    if (!prompt) throw new NotFoundError("Prompt", id);
    return prompt;
  },

  async create(input: CreatePromptInput) {
    return repo().create(input);
  },

  async update(id: string, userId: string, input: UpdatePromptInput) {
    await this.getById(id, userId);
    return repo().update(id, userId, input);
  },

  async delete(id: string, userId: string) {
    await this.getById(id, userId);
    return repo().softDelete(id, userId);
  },

  async list(userId: string, params: PaginationParams & { promptType?: PromptType; search?: string }) {
    return repo().listByUser(userId, params);
  },

  async getVersionHistory(promptId: string, userId: string) {
    return repo().getVersionHistory(promptId, userId);
  },

  async createVersion(parentId: string, userId: string, optimizedContent: string, tokenData?: {
    optimizedTokenCount?: number;
    compressionRatio?: number;
  }) {
    const parent = await this.getById(parentId, userId);
    return repo().create({
      userId,
      originalContent: parent.originalContent,
      optimizedContent,
      title: parent.title ?? undefined,
      tags: parent.tags,
      promptType: parent.promptType,
      originalTokenCount: parent.originalTokenCount ?? undefined,
      parentId,
      ...tokenData,
    });
  },
};
