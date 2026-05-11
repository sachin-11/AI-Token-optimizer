# AI Prompt Optimization Platform — Architecture

## Folder Structure

```
ai-prompt-optimizer/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (dashboard)/              # Route group — dashboard layout
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx              # Dashboard home
│   │   │   ├── optimize/             # Prompt optimization UI
│   │   │   ├── history/              # Optimization history
│   │   │   └── analytics/            # Token & cost analytics
│   │   ├── api/
│   │   │   ├── v1/
│   │   │   │   ├── optimize/         # POST /api/v1/optimize
│   │   │   │   ├── prompts/          # CRUD /api/v1/prompts
│   │   │   │   ├── analytics/        # GET /api/v1/analytics
│   │   │   │   └── models/           # GET /api/v1/models
│   │   │   ├── health/               # GET /api/health
│   │   │   └── metrics/              # GET /api/metrics (Prometheus)
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── error.tsx                 # Global error boundary
│   │   ├── not-found.tsx
│   │   └── globals.css
│   │
│   ├── agents/                       # LangGraph multi-agent workflows
│   │   ├── graph/
│   │   │   └── optimization.graph.ts # Main optimization workflow
│   │   ├── nodes/
│   │   │   ├── analyzer.node.ts      # Analyzes prompt structure
│   │   │   ├── compressor.node.ts    # Compresses tokens
│   │   │   ├── optimizer.node.ts     # Semantic optimization
│   │   │   └── validator.node.ts     # Validates output quality
│   │   ├── state/
│   │   │   └── optimization.state.ts # Shared agent state
│   │   └── tools/
│   │       └── token-counter.tool.ts # LangChain tool
│   │
│   ├── services/                     # Business logic layer
│   │   ├── ai/
│   │   │   ├── providers/
│   │   │   │   ├── openai.provider.ts
│   │   │   │   └── anthropic.provider.ts
│   │   │   ├── ai-provider.interface.ts
│   │   │   └── ai-router.service.ts  # Routes to best provider
│   │   ├── optimization/
│   │   │   ├── optimization.service.ts
│   │   │   ├── compression.service.ts
│   │   │   └── summarization.service.ts
│   │   ├── cache/
│   │   │   └── semantic-cache.service.ts
│   │   ├── token/
│   │   │   └── token-counter.service.ts
│   │   ├── cost/
│   │   │   └── cost-tracker.service.ts
│   │   └── queue/
│   │       └── queue.service.ts
│   │
│   ├── workers/                      # BullMQ background workers
│   │   ├── optimization.worker.ts
│   │   └── analytics.worker.ts
│   │
│   ├── components/                   # React components
│   │   ├── ui/                       # shadcn/ui primitives
│   │   ├── features/                 # Feature-specific components
│   │   │   ├── optimizer/
│   │   │   ├── analytics/
│   │   │   └── history/
│   │   └── shared/                   # Shared layout components
│   │       ├── header.tsx
│   │       ├── sidebar.tsx
│   │       └── loading.tsx
│   │
│   ├── hooks/                        # Custom React hooks
│   │   ├── use-optimization.ts
│   │   ├── use-token-count.ts
│   │   └── use-streaming.ts
│   │
│   ├── lib/                          # Infrastructure & utilities
│   │   ├── prisma.ts                 # DB client singleton
│   │   ├── redis.ts                  # Redis client singleton
│   │   ├── logger.ts                 # Pino logger
│   │   ├── telemetry.ts              # OpenTelemetry setup
│   │   ├── errors.ts                 # Error class hierarchy
│   │   ├── error-handler.ts          # Route handler wrapper
│   │   └── api-response.ts           # Response builders
│   │
│   ├── config/
│   │   ├── env.ts                    # Zod-validated env vars
│   │   └── app.ts                    # App constants
│   │
│   ├── types/
│   │   ├── api.ts                    # API response types
│   │   ├── optimization.ts           # Domain types
│   │   └── ai.ts                     # AI provider types
│   │
│   ├── utils/
│   │   ├── cn.ts                     # Tailwind class merger
│   │   ├── async.ts                  # Retry, timeout, concurrency
│   │   └── validation.ts             # Zod request validators
│   │
│   ├── middleware.ts                 # Edge middleware
│   └── instrumentation.ts           # OTel initialization
│
├── prisma/
│   ├── schema.prisma                 # DB schema with pgvector
│   └── migrations/                   # Auto-generated migrations
│
├── docker/
│   ├── postgres/init.sql             # pgvector extension init
│   └── prometheus/prometheus.yml
│
├── k8s/
│   └── deployment.yaml               # K8s Deployment + HPA
│
├── Dockerfile                        # Multi-stage production build
├── docker-compose.yml                # Local dev infrastructure
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
└── .env.example
```

## Key Architecture Decisions

### 1. Service Layer Pattern
Route handlers are thin — they parse input, call a service, return a response.
All business logic lives in `src/services/`. This makes services testable in isolation.

### 2. Dependency Injection via Factory Functions
Services are created via factory functions, not class constructors.
This avoids IoC container complexity while keeping code testable and modular.

### 3. LangGraph for Agent Orchestration
Multi-agent workflows use LangGraph state machines. Each node is a pure function.
This gives us: resumability, parallel execution, conditional branching, and observability.

### 4. Semantic Caching with pgvector
Before calling an LLM, we check if a semantically similar prompt exists in cache.
Similarity threshold: 0.92 (configurable). This can reduce LLM costs by 30-60%.

### 5. BullMQ for Async Jobs
Prompt optimization can take 5-30 seconds. We queue jobs and stream results back.
This prevents HTTP timeouts and enables retry logic with exponential backoff.

### 6. Multi-Model Support via Provider Abstraction
All AI calls go through `AIProvider` interface. Adding a new provider = implementing the interface.
The AI Router selects the best provider based on: cost, latency, availability, model capabilities.
