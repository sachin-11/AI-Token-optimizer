import "server-only";

import { getUserRepository, type CreateUserInput, type UpdateUserInput } from "@/repositories/user.repository";
import { type PaginationParams } from "@/repositories/base.repository";
import { NotFoundError } from "@/lib/errors";

const repo = () => getUserRepository();

export const UserService = {
  async getById(id: string) {
    const user = await repo().findById(id);
    if (!user) throw new NotFoundError("User", id);
    return user;
  },

  async getByEmail(email: string) {
    return repo().findByEmail(email);
  },

  async getByApiKey(apiKey: string) {
    return repo().findByApiKey(apiKey);
  },

  async create(input: CreateUserInput) {
    const existing = await repo().findByEmail(input.email);
    if (existing) throw new Error(`User with email ${input.email} already exists`);
    return repo().create(input);
  },

  async update(id: string, input: UpdateUserInput) {
    await this.getById(id); // assert exists
    return repo().update(id, input);
  },

  async delete(id: string) {
    await this.getById(id);
    return repo().softDelete(id);
  },

  async rotateApiKey(id: string) {
    await this.getById(id);
    return repo().rotateApiKey(id);
  },

  async list(params: PaginationParams & { search?: string }) {
    return repo().list(params);
  },
};
