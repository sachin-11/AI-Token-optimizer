# AI Prompt Optimizer (Token Optimizer)

Next.js application that compresses and optimizes long prompts using a LangGraph-style multi-agent workflow, accurate token counting (tiktoken), optional semantic caching (PostgreSQL + pgvector), and background jobs (Redis + BullMQ). It supports multiple LLM providers (OpenAI, Anthropic, Gemini).

## Features

- **Optimization playground** — Paste a prompt, pick a model and mode (safe / balanced / aggressive), and stream progress from analyzer, compression, and review steps.
- **Streaming API** — `POST /api/v1/optimize/stream` returns Server-Sent Events for live UI updates.
- **Multi-provider routing** — Configure default and fallback models per provider via environment variables.
- **Persistence & cache** — Prisma + PostgreSQL for optimization history; Redis for queues and cache-related workloads.

## Tech stack

- **App:** Next.js 15, React 19, TypeScript, Tailwind CSS
- **AI:** LangChain / LangGraph-style agents, OpenAI, Anthropic, Google Gemini
- **Data:** Prisma 5, PostgreSQL (pgvector-ready in schema comments)
- **Infra:** Redis, BullMQ workers, optional OpenTelemetry

## Prerequisites

- Node.js 20+ (recommended for Next.js 15)
- PostgreSQL instance with a database created for the app
- Redis (for BullMQ / cache features used in production or full local runs)

## Setup

1. **Install**

   ```bash
   cd Token-optmizer
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env.local` and set at least:

   - `DATABASE_URL` — PostgreSQL connection string
   - `REDIS_URL` — Redis connection string (when using workers / queues)
   - One or more of: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
   - `NEXTAUTH_SECRET` and `NEXTAUTH_URL` for auth (see `.env.example`)
   - Adjust `NEXT_PUBLIC_APP_URL` if not running on `http://localhost:3000`

3. **Database**

   Generate the Prisma client and apply the schema to your database:

   ```bash
   npx prisma generate
   npx prisma db push
   ```

   If you use migrations in your workflow, replace `db push` with `npx prisma migrate dev`.

4. **Run the app**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The optimization UI lives under the dashboard (e.g. `/dashboard/optimize`).

5. **Workers (optional)**

   For async BullMQ jobs, start the worker process in another terminal:

   ```bash
   npm run workers
   ```

## npm scripts

| Script            | Description                    |
| ----------------- | ------------------------------ |
| `npm run dev`     | Next.js development server     |
| `npm run build`   | Production build               |
| `npm run start`   | Production server              |
| `npm run workers` | BullMQ worker process          |
| `npm run lint`    | ESLint                         |
| `npm run type-check` | TypeScript check (no emit) |

## Project layout (high level)

- `src/app/` — App Router pages and API routes
- `src/agents/` — Agent nodes, workflow orchestration, state
- `src/services/` — AI routing, token counting, DB, cache, semantic search
- `src/workers/` — BullMQ worker entrypoints
- `prisma/` — Database schema

See the small `README.md` files under `src/agents/`, `src/workers/`, and related folders for layer-specific notes.

## License

Private project (`"private": true` in `package.json`). Add a `LICENSE` file if you plan to open-source it.
