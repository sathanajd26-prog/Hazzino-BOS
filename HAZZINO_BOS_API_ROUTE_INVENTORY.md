# Hazzino BOS — API Route Inventory & Classification

Complete security classification and authentication requirements for all **184 API routes** in Hazzino BOS.

Generated during Phase 5D-2: Individual Authentication & Server-Side Enforcement.

## Summary of Classifications

| Category | Count | Security Enforcement |
|---|---|---|
| 1. Public Authentication Endpoints | 3 | Open with brute-force rate limiting & constant-time validation |
| 2. Public Webhooks (Verified) | 1 | Shared secret validation in constant time; GET protected |
| 3. Machine-to-Machine Endpoints | 5 | Bearer token / OAuth state verification (fails closed to session) |
| 4. Sensitive Endpoints (Future RBAC) | 24 | Authenticated session required now; role restrictions in Phase 5D-3 |
| 5. Internal Diagnostics Endpoints | 2 | Authenticated session required / loopback diagnostics |
| 6. Normal Employee Endpoints | 149 | Authenticated employee session required |
| **Total API Route Handlers** | **184** | **100% Accounted For** |

## 1. Public Authentication Endpoints (3)

| Path | HTTP Methods | Purpose / Security Requirement |
|---|---|---|
| `/api/auth/check` | GET | Internal middleware probe / session status check |
| `/api/auth/login` | POST | Individual employee login and session creation |
| `/api/auth/logout` | POST | Session revocation and cookie clearing |

## 2. Public Webhooks with Independent Verification (1)

| Path | HTTP Methods | Purpose / Security Requirement |
|---|---|---|
| `/api/webhooks/manychat` | POST, GET | ManyChat Instagram DM webhook (verified via x-manychat-secret, GET protected) |

## 3. Machine-to-Machine Endpoints with Secure Token Auth (5)

| Path | HTTP Methods | Purpose / Security Requirement |
|---|---|---|
| `/api/trading/snapshot` | POST | Markets agent trade snapshot push (TRADING_PUSH_TOKEN) |
| `/api/trading/limits` | GET, PATCH | Trading limits query (TRADING_PUSH_TOKEN for GET, session for PATCH) |
| `/api/usage/push` | POST | Resource usage metrics push (USAGE_PUSH_TOKEN) |
| `/api/plaud/ingest` | POST | Plaud audio note ingestion (PLAUD_INGEST_TOKEN) |
| `/api/lab/oauth/[provider]/callback` | GET | OAuth 2.0 PKCE redirect callback with provider state verification |

## 4. Sensitive Endpoints Requiring Future Role-Based Authorization (24)

| Path | HTTP Methods | Purpose / Security Requirement |
|---|---|---|
| `/api/auth/password` | POST | Administrative password update, session rotation, and revocation |
| `/api/keys` | GET, POST | System API keys and environment secret management |
| `/api/finances/bank-statement` | POST | Bank statement PDF extraction and sensitive transaction parsing |
| `/api/finances/statements` | GET, POST | Financial ledger and statement records |
| `/api/trading` | GET, POST | Financial trading execution and positions |
| `/api/database` | GET, POST | Database maintenance, dump, and direct SQLite operations |
| `/api/database/file` | GET | Direct raw database file download |
| `/api/settings/filming` | GET, POST | Demo / Filming mode toggles and isolated store resets |
| `/api/settings/modules` | GET, POST | System module activation and feature gating |
| `/api/departments` | GET, POST | Organizational department structure configuration |
| `/api/brain` | GET, POST | Enterprise knowledge base core memory and query |
| `/api/brain/dump` | GET | Full corporate knowledge base export |
| `/api/brain/graph` | GET | Knowledge graph structure and relations |
| `/api/brain/overview` | GET | Brain store health diagnostics and file inspection |
| `/api/cron/tick` | GET, POST | System background cron execution |
| `/api/cron/run` | POST | Manual trigger of background scheduled jobs |
| `/api/brand-deals/rules` | GET, POST | Commercial brand sponsorship negotiation rules |
| `/api/brand-deals/rules/restore` | POST | Reset commercial negotiation rules |
| `/api/brand-deals/override` | POST | Financial sponsorship rate override |
| `/api/brand-deals/send` | POST | Outbound commercial sponsorship agreement dispatch |
| `/api/creative-engine/arcads/setup` | POST | Paid external AI video generation API credentials |
| `/api/creative-engine/runs/[id]/abandon` | POST | Cloud compute job abort |
| `/api/lab/setup/keys` | GET, POST | Content lab third-party API credentials |
| `/api/lab/setup/caps` | GET, POST | Content lab financial and usage budget caps |

## 5. Internal Diagnostics Endpoints (2)

| Path | HTTP Methods | Purpose / Security Requirement |
|---|---|---|
| `/api/setup/check` | GET | Initial deployment diagnostic check |
| `/api/lab/setup/health` | GET | Content lab environment health check |

## 6. Normal Authenticated Employee Endpoints (149)

| Path | HTTP Methods | Purpose / Security Requirement |
|---|---|---|
| `/api/adscout/ask` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/adscout/mine` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/adscout/saved` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/adscout/sync` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/adscout/watchlist` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/[id]/chat` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/[id]/failover` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/[id]/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/activity` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/broadcast` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/deliverables/decision` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/agents/work` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/blueprint` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/blueprint/ask` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/board/agents/[id]/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/board/deliverables` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/board/deliverables/decision` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/board/live` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/brand-deals` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/brand-deals/draft` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/calls/archive` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/chats` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/chats/[agentId]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/clients` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/clients/confirm` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/clients/work` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/clients/work/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/clients/work/[id]/launch` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/comms` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/comms/digest` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/comms/digest/read` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/comms/reply` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/compute` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/compute/embed` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/conductor/chat` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/conductor/context` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/connections` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/connections/connect` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/connections/summary` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/contacts/tags` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/pipelines` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/pipelines/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/pipelines/[id]/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/pipelines/draft` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/queue` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/queue/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/queue/spec` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/refine-prompt` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/content/upload` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/angles` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/assets` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/catalog` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/health` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/image` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/motion` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/presets` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/arcads/ugc` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/briefs` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/briefs/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/campaigns` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/campaigns/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/presets` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/research` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/runs` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/scripts` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/scripts/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows/[id]/duplicate` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows/[id]/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows/[id]/stop` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows/[id]/versions` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/creative-engine/workflows/[id]/versions/[n]/restore` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/funnel` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/funnel/lead-message` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/interject` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/ask` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/comments` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/embeddings` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/frames` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/ideas` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/intel` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/ledger` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/ledger/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/morning-brief` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/oauth/[provider]/disconnect` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/oauth/[provider]/start` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/planner` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/posts` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/predictions` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/predictions/[id]/void` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/radar` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/radar/event` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/retention` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/retention/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/rules` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/run` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/runs` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/script` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/scripts` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/setup` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/setup/pause` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/setup/schedule` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/sheet` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/snapshots` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/sources` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/specimen` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/suggestions` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/tests` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/tests/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/tests/[id]/judge` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lab/verify-actors` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lead-magnets` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/lead-magnets/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/life/map` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/metrics` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/roadmap` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/skills/[slug]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/skills/create` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/skills/propose` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/[platform]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/dm/reply` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/history` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/posts` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/series` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/sync` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/social/upload` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/tasks/export` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/tools` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/trakyo/links` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/usage` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/ventures` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/whatsapp/avatar/[key]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/whatsapp/media` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/whatsapp/thread` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/wizard/crew` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/wizard/designed` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/wizard/engine` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/wizard/projects` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/wizard/projects/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/wizard/send` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/workflows` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/workflows/[id]` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/workflows/[id]/versions` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/workflows/[id]/versions/restore` | GET / POST / PATCH / DELETE | Authenticated employee business operation |
| `/api/workflows/draft` | GET / POST / PATCH / DELETE | Authenticated employee business operation |

