# Services Layer

Business logic lives here. Services are injected into route handlers and server actions.
Each service is a pure function factory — no class instantiation required.

## Structure
- `ai/` — AI provider abstractions (OpenAI, Anthropic)
- `optimization/` — Prompt optimization orchestration
- `cache/` — Semantic caching service
- `queue/` — BullMQ job management
- `token/` — Token counting and analytics
- `cost/` — Cost tracking and analytics
