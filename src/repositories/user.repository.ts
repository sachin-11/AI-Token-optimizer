import "server-only";

import { type User, type Prisma } from "@prisma/client";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "@/repositories/base.repository";

export type CreateUserInput = Pick<User, "email"> & Partial<Pick<User, "name">>;
export type UpdateUserInput = Partial<Pick<User, "name" | "email">>;

export class UserRepository extends BaseRepository {
  constructor() { super("User"); }

  async findById(id: string): Promise<User | null> {
    try {
      return await this.db.user.findFirst({ where: { id, deletedAt: null } });
    } catch (e) { this.handleError(e, "findById"); }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.db.user.findFirst({ where: { email, deletedAt: null } });
    } catch (e) { this.handleError(e, "findByEmail"); }
  }

  async findByApiKey(apiKey: string): Promise<User | null> {
    try {
      return await this.db.user.findFirst({ where: { apiKey, deletedAt: null } });
    } catch (e) { this.handleError(e, "findByApiKey"); }
  }

  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.db.user.create({ data: input });
    } catch (e) { this.handleError(e, "create"); }
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    try {
      return await this.db.user.update({ where: { id }, data: input });
    } catch (e) { this.handleError(e, "update"); }
  }

  async softDelete(id: string): Promise<void> {
    try {
      await this.db.user.update({ where: { id }, data: { deletedAt: new Date() } });
    } catch (e) { this.handleError(e, "softDelete"); }
  }

  async rotateApiKey(id: string): Promise<User> {
    try {
      const { nanoid } = await import("nanoid");
      return await this.db.user.update({ where: { id }, data: { apiKey: nanoid() } });
    } catch (e) { this.handleError(e, "rotateApiKey"); }
  }

  async list(params: PaginationParams & { search?: string }): Promise<PaginatedResult<User>> {
    const { skip, take } = this.buildPagination(params);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(params.search && {
        OR: [
          { email: { contains: params.search, mode: "insensitive" } },
          { name:  { contains: params.search, mode: "insensitive" } },
        ],
      }),
    };
    try {
      const [data, total] = await this.db.$transaction([
        this.db.user.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
        this.db.user.count({ where }),
      ]);
      return this.buildPaginatedResult(data, total, params);
    } catch (e) { this.handleError(e, "list"); }
  }
}

let instance: UserRepository | null = null;
export function getUserRepository(): UserRepository {
  instance ??= new UserRepository();
  return instance;
}
