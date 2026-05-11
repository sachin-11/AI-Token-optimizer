-- Initialize pgvector extension
-- This must run before Prisma migrations
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
