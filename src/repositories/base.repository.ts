import "server-only";

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createChildLogger } from "@/lib/logger";
import { DatabaseError, NotFoundError } from "@/lib/errors";

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SoftDeletable {
  deletedAt: Date | null;
}

export abstract class BaseRepository {
  protected readonly db: PrismaClient = prisma;
  protected readonly log;

  constructor(modelName: string) {
    this.log = createChildLogger({ repository: modelName });
  }

  protected buildPagination(params: PaginationParams): { skip: number; take: number } {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    return { skip: (page - 1) * pageSize, take: pageSize };
  }

  protected buildPaginatedResult<T>(
    data: T[],
    total: number,
    params: PaginationParams,
  ): PaginatedResult<T> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const totalPages = Math.ceil(total / pageSize);
    return {
      data,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  protected handleError(error: unknown, context: string): never {
    this.log.error({ err: error, context }, "Database error");
    throw new DatabaseError(`Database operation failed: ${context}`, error instanceof Error ? error : undefined);
  }

  protected assertFound<T>(value: T | null, resource: string, id: string): T {
    if (!value) throw new NotFoundError(resource, id);
    return value;
  }
}
