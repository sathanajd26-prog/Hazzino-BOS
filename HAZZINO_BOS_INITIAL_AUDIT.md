# Hazzino Business Operating System (Hazzino BOS)
## Initial Repository Audit & Architecture Assessment Report

> **Audit Date:** November 5, 2026  
> **Repository:** `Hazzino-BOS` (derived from FounderOS v3 / GladOS)  
> **Audit Status:** Complete Read-Only Technical Audit  
> **Report Target:** `HAZZINO_BOS_INITIAL_AUDIT.md`  

---

## Executive Summary

The **Hazzino BOS** repository is built upon **FounderOS v3** (internally merged with the **GladOS** personal operating system engine). The application is designed as an all-in-one executive command center and autonomous multi-agent operating system. It coordinates revenue pipelines, inbound/outbound communications, marketing/content intelligence, financial accounting, strategic knowledge graphs, and a roster of specialized AI agents.

The codebase is structured as a **monolithic Next.js 14 (App Router) full-stack TypeScript application** backed by an embedded **SQLite** database (`better-sqlite3`), with local file storage and direct integrations to desktop and cloud-hosted third-party tools.

### Key Architectural Strengths
1. **Self-Contained Architecture:** Single Node.js service containing the UI, backend API routes, background cron loops, and database engine without requiring external container or database server orchestration for local development.
2. **Robust Multi-Mode Design System:** Fully decoupled multi-theme and multi-style engine featuring `classic`, `glados` (modern tokens), and `legacy` (Monolith) visual faces, backed by Geist typography and custom Tailwind tokens.
3. **Multi-Agent Runtime & Tool Calling:** Built-in agent orchestrator (`Conductor` / `Wizard`) utilizing the Vercel AI SDK (`ai`), supporting tool execution, model failover, and local Claude CLI session delegation.
4. **Isolated Demo vs. Real Data Isolation:** Strict directory-level segregation (`data/` vs `demo-data/`), preventing accidental destruction of operational records during demonstrations.
5. **Extensive Test Coverage:** Over 360 Vitest test suites enforcing strict rules around metrics honesty, UI component integrity, route status, and connector health.

### Critical Considerations for Hazzino BOS
1. **Single-Tenant / Single-Operator Design:** Authentication assumes a single operator password. There is no multi-user role-based access control (RBAC), multi-tenant tenancy partitioning, or user management system.
2. **Local macOS Environment Coupling:** Multiple connectors assume execution on an operator's local macOS desktop (e.g., reading macOS WhatsApp group container SQLite files, shelling out to local `claude`, `gbrain`, and `gsend` CLI binaries, and inspecting `~/.claude/` transcript directories).
3. **Node Version & Native Binaries:** Requires Node.js 22 LTS due to `better-sqlite3` native C++ bindings stability. Newer Node releases (e.g., Node 24/26) can trigger native assertion crashes during test runs.
4. **Missing Workspace Dependencies:** `node_modules` is currently absent in the workspace, requiring an initial clean install (`npm ci`) under a supported Node.js 22 environment before executing builds or tests.

---

## 1. System Architecture Overview

```
                                      +-------------------------------------------------------+
                                      |                 Browser / Client App                  |
                                      |  (Geist Typography, Tailwind Tokens, SWR Data Layer)   |
                                      +-------------------------------------------------------+
                                                                 |
                                                                 v
                                      +-------------------------------------------------------+
                                      |               Next.js Edge Middleware                 |
                                      |   - Loopback / Host validation                        |
                                      |   - Scrypt Session Verification (via node probe)      |
                                      |   - Token Bypass for Push Webhooks                    |
                                      |   - CSRF Cross-Origin Filtering                       |
                                      +-------------------------------------------------------+
                                                                 |
                                      +--------------------------+----------------------------+
                                      |                                                       |
                                      v                                                       v
                   +------------------------------------+                  +------------------------------------+
                   |     Next.js 14 App Router UI       |                  |        REST API Route Layer        |
                   |   - / (Home Console)               |                  |   - /api/agents, /api/chats        |
                   |   - /wizard, /inbox                |                  |   - /api/funnel, /api/brand-deals  |
                   |   - /finances, /trading, /clients  |                  |   - /api/lab, /api/creative-engine |
                   |   - /social, /lab, /adpilot        |                  |   - /api/connections, /api/compute |
                   |   - /agents, /tasks, /workflows    |                  |   - /api/cron/tick, /api/webhooks  |
                   |   - /brain, /database, /knowledge  |                  +------------------------------------+
                   |   - /setup, /integrations, /usage  |                                     |
                   +------------------------------------+                                     |
                                      |                                                       |
                                      +--------------------------+----------------------------+
                                                                 |
                                                                 v
                                      +-------------------------------------------------------+
                                      |               Domain & Services Layer (lib/)          |
                                      |   - Agent Runtime & Conductor Orchestrator            |
                                      |   - SWR In-Memory Cache (lib/swr.ts)                  |
                                      |   - Credential Resolver (lib/creds.ts)                |
                                      |   - Connectors (30+ integrations)                     |
                                      +-------------------------------------------------------+
                                          |                     |                         |
               +--------------------------+                     |                         +--------------------------+
               v                                                v                                                    v
+-------------------------------+              +---------------------------------+              +----------------------------------+
|   SQLite Data Layer (lib/db)  |              |    Local CLI & Subprocess Engine|              |    External Cloud Integrations   |
|   - better-sqlite3            |              |    - claude CLI (Wizard / UGC)  |              |    - Vercel AI Gateway (LLM)     |
|   - Real Store: data/glados.db|              |    - gbrain CLI (Hybrid Search) |              |    - Stripe, PayPal, Wise        |
|   - Demo: demo-data/glados.db |              |    - gsend (Mail dispatcher)    |              |    - GoHighLevel, Attio, Trakyo  |
|   - Zod Typed Repositories    |              |    - ffmpeg / ffprobe (Lab)     |              |    - Apify, Arcads, Foreplay     |
+-------------------------------+              +---------------------------------+              +----------------------------------+
```

### 1.1 Frontend Architecture
- **Framework:** Next.js 14.2.13 using the App Router (`app/` directory) and React 18.3.1.
- **Rendering Model:** Server Components by default with client component hydration (`'use client'`) for interactive widgets, SVG camera viewports, D3 graphs, and form inputs.
- **Styling & Design Tokens:** Tailwind CSS 3.4.12 configured with CSS variable semantic tokens (`var(--surface)`, `var(--accent)`, `var(--text)`, etc.). Supports three distinct UI modes:
  - `glados`: Contemporary enterprise command system with 4 accent presets (`ice`, `lime`, `ember`, `mint`) and Dark/Light/System preferences.
  - `classic`: Standard dark console UI with 5 palette variants (`console`, `red`, `light`, `frost`, `grey-frost`).
  - `legacy`: Bennett Legacy / FounderOS v1 Monolith aesthetic utilizing JetBrains Mono.
- **Data Hydration & Caching:** Custom Stale-While-Revalidate (SWR) cache pattern implemented server-side (`lib/swr.ts`) and client hooks (`useChats`, `use-clients`, `use-deal-board`, `use-trading`, etc.).

### 1.2 Backend Architecture
- **Server Environment:** Node.js runtime executing Next.js Route Handlers (`app/api/**/route.ts`).
- **Startup Instrumentation:** `instrumentation.ts` bootstraps on server startup:
  1. Initializes the demo store if in demo mode (`lib/demo/store.ts`).
  2. Warms connector caches in the background (`lib/warm.ts`).
  3. Registers the 60-second background cron loop (`lib/cron-loop.ts`) when `GLADOS_CRON=1`.
- **Boot Wrapper:** Custom launcher `scripts/serve.mjs` controls process binding, verifying password protection before allowing non-loopback network exposure.

---

## 2. Technology Stack & Dependencies

### 2.1 Core Framework & Runtime
| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | 22 LTS (Target) | High-performance JS runtime |
| **Framework** | Next.js (App Router) | `14.2.13` | Full-stack web framework & API layer |
| **UI Library** | React / React-DOM | `18.3.1` | Component rendering engine |
| **Language** | TypeScript | `5.6.2` | Static type safety |
| **Validation** | Zod | `3.23.8` | Schema validation for database & APIs |

### 2.2 Styling, Typography & Visuals
| Package | Version | Purpose |
| :--- | :--- | :--- |
| **Tailwind CSS** | `3.4.12` | Utility-first design tokens and responsive layouts |
| **PostCSS / Autoprefixer** | `8.4.47` / `10.4.20` | CSS preprocessing and vendor prefixing |
| **Lucide React** | `0.441.0` | Comprehensive vector stroke icon system |
| **Simple Icons** | `16.27.0` | Brand and third-party service SVG logos |
| **d3-force** | `3.0.0` | Force-directed simulations for the knowledge graph |
| **Local Fonts** | Local Assets | Geist, Geist Mono, Brockmann Medium, JetBrains Mono |

### 2.3 Storage & Database
| Package | Version | Purpose |
| :--- | :--- | :--- |
| **better-sqlite3** | `11.3.0` | High-performance synchronous SQLite driver |
| **@types/better-sqlite3** | `7.6.11` | TypeScript definitions for SQLite interface |

### 2.4 AI & Agent Ecosystem
| Package | Version | Purpose |
| :--- | :--- | :--- |
| **ai (Vercel AI SDK)** | `6.0.208` | Unified LLM abstraction and tool execution |
| **@miosa/sdk** | `3.2.5` | Headless browser automation and remote desktop compute |
| **Local Claude CLI** | Subprocess | Deep-turn project conversations, code and script drafting |

### 2.5 Third-Party Integrations
| Package | Version | Purpose |
| :--- | :--- | :--- |
| **imapflow** | `1.4.0` | IMAP protocol engine for email inbox monitoring |
| **nodemailer** | `9.0.1` | SMTP email dispatch engine |
| **@slack/web-api** | `7.16.0` | Slack Bot API client for channel reading |
| **@notionhq/client** | `5.22.0` | Notion workspace API connector |
| **stripe** | `22.2.0` | Payment processing, charges, and balance retrieval |
| **node-ical** | `0.26.1` | iCal calendar feed parser |

### 2.6 Testing & Tooling
| Package | Version | Purpose |
| :--- | :--- | :--- |
| **Vitest** | `2.1.1` | Fast unit, integration, and contract test runner |
| **tsx** | `4.19.1` | Direct TypeScript execution for utility scripts |

---

## 3. Repository & Folder Structure

```
Hazzino-BOS/
├── .env.example               # Full template of all supported environment variables
├── .gitignore                 # Excludes .env.local, data/, demo-data/, build outputs
├── .node-version              # Set to 24.14.0 (Note: README recommends Node 22 LTS)
├── AGENTS.md                  # House rules and non-negotiable guidelines for coding agents
├── CLAUDE.md                  # Comprehensive developer documentation & operations manual
├── LICENSE                    # MIT open-source license
├── README.md                  # Project overview, setup, and getting-started guide
├── package.json               # Manifest defining scripts and dependencies
├── tsconfig.json              # TypeScript compilation rules with '@/*' path aliases
├── next.config.mjs            # Next.js configuration (redirects, rewrites, distDir, external packages)
├── tailwind.config.ts         # Tailwind theme extension, animations, and token bindings
├── postcss.config.mjs         # PostCSS plugins setup
├── vitest.config.ts           # Test runner aliases, environment setup, and hermetic env stubs
├── middleware.ts              # Edge authentication and request gatekeeper
├── instrumentation.ts         # Node.js server boot hook (cache warming and cron initialization)
│
├── app/                       # Next.js 14 App Router Directory
│   ├── layout.tsx             # Root layout: font loading, theme scripts, shell wrapper
│   ├── template.tsx           # Page transition wrapper
│   ├── globals.css            # Core CSS tokens, themes (console, red, light, frost), animations
│   ├── page.tsx               # Root Home console (/), routing to Home6Console
│   ├── login/                 # Operator authentication screen
│   ├── wizard/                # Autonomous agent orchestration console
│   ├── inbox/                 # Unified Comms triage (Email, WhatsApp, Slack)
│   ├── funnel/                # Sales pipeline & contact attribution
│   ├── brand-deals/           # Sponsorship management & deal workflow
│   ├── clients/               # Client roster, contracts, and Superset launches
│   ├── finances/              # Treasury, Stripe balance, ledger, statements
│   ├── trading/               # Market sleeve snapshot, positions, and limits
│   ├── social/                # Multi-platform social metrics, composer, DM inbox
│   ├── adpilot/               # Ad intelligence, Meta campaigns, 3D Globe
│   ├── creative-engine/       # UGC script generation, Arcads actor studio
│   ├── lab/                   # Content Lab (viral breakout radar, dissections, ideas)
│   ├── lead-magnets/          # Landing pages and lead capture campaigns
│   ├── agents/                # Agent roster, run execution, and configuration
│   ├── chats/                 # 1-on-1 direct agent conversation threads
│   ├── tasks/                 # Kanban task board and workload allocation
│   ├── workflows/             # Visual DAG automation workflow builder
│   ├── skills/                # Agent skill library and SOP markdown definitions
│   ├── compute/               # Miosa remote browser automation console
│   ├── brain/                 # Optimal Engine / G-Brain hybrid search interface
│   ├── database/              # Filesystem explorer for markdown brain repository
│   ├── knowledge/             # D3 interactive knowledge graph visualizer
│   ├── drift/                 # Contradiction detection engine for knowledge docs
│   ├── setup/                 # Settings: themes, security, module toggling, checklist
│   ├── integrations/          # Connector status dashboard and credential inputs
│   ├── usage/                 # Token consumption monitoring (Claude, Codex, OpenAI)
│   ├── blueprint/             # Interactive architectural system diagram
│   ├── roadmap/               # Strategic phases, quarters, and milestones
│   ├── org/                   # Departmental structure and personnel hierarchy
│   ├── dev/                   # Component galleries (g-kit and l-kit design specs)
│   └── api/                   # REST API backend handlers (120+ route endpoints)
│
├── components/                # Modular UI Component Library
│   ├── Topbar.tsx             # Global application header, breadcrumbs, status indicators
│   ├── Sidebar.tsx            # Main collapsible navigation rail and group selector
│   ├── CommandPalette.tsx     # ⌘K instant search, digit shortcuts (1-9), command runner
│   ├── ModuleGate.tsx         # Gatekeeper component enforcing enabled/disabled modules
│   ├── AppearanceSync.tsx     # Client-side theme and appearance synchronization
│   ├── ShellGate.tsx          # Conditional layout wrapper (bare routes vs full shell)
│   ├── RouteSkeleton.tsx      # Standardized loading placeholders
│   ├── Home6Console.tsx       # Primary Executive Console dashboard implementation
│   ├── agents/                # Agent cards, roster sheets, and setup panels
│   ├── chats/                 # Agent chat interfaces (ChatsG, ChatsClassic, ChatsLegacy)
│   ├── clients/               # Client management grids and status drawers
│   ├── comms-fo/              # Inbox components, message detail viewers, digest displays
│   ├── creative-engine/       # Video generators, drawers, motion consoles, scripters
│   ├── finances/              # Revenue charts, account summaries, statement uploaders
│   ├── funnel/                # Journey charts, pipeline funnels, contact tables
│   ├── lab/                   # Content Lab radar, test runners, idea generators
│   ├── knowledge/             # D3 Knowledge graph rendering canvases
│   ├── trading/               # Portfolio charts, position tables, order cards
│   ├── workflows/             # Drag-and-drop node canvas and workflow execution trees
│   ├── legacy/                # Bennett Legacy / Monolith UI components
│   └── ui/                    # Reusable atom components (Toast, Dialog, Inputs)
│
├── founderos/                 # FounderOS v1 Legacy Merge Layer
│   ├── components/            # Legacy board live views, deliverables, volume meters
│   └── lib/                   # Deliverable decisions, approval queues, short labels
│
├── lib/                       # Core Business Logic, Data Repositories & Utilities
│   ├── brand.ts               # Brand definition (GladOS vs FounderOS branding metadata)
│   ├── paths.ts               # Data directory resolver (data/ vs demo-data/)
│   ├── creds.ts               # Multi-source credential resolver & .env.local manager
│   ├── auth.ts                # Scrypt password hashing & session token generator
│   ├── auth-gate.ts           # Network loopback validation & gatekeeper decision engine
│   ├── push-auth.ts           # Token-based authentication for external push agents
│   ├── db.ts                  # SQLite database connection, DDL definitions, migrations
│   ├── data.ts                # Database singleton instantiation and seed trigger
│   ├── schemas.ts             # Complete domain model Zod validation schemas
│   ├── seed.ts                # Structural database seed (departments and agents)
│   ├── nav.ts                 # Master navigation definitions and route categorization
│   ├── modules.ts             # Module enable/disable filtering logic
│   ├── modules-server.ts      # Server-side persistence of module preferences
│   ├── theme.ts               # Classic theme registry and metadata
│   ├── appearance.ts          # Tri-axis appearance engine (UI style, accent, mode)
│   ├── swr.ts                 # Server-side & client-side stale-while-revalidate cache
│   ├── cron.ts                # Cron pattern validation and evaluation
│   ├── cron-loop.ts           # 60-second background cron execution loop
│   ├── agents/                # Agent runtime, chat orchestration, and Conductor routing
│   ├── connectors/            # 30+ service connectors (Email, Stripe, Slack, Notion, etc.)
│   ├── creative-engine/       # UGC generation, Arcads API, video script compose logic
│   ├── foreplay/              # Ad library client, brand dossiers, sync cycles
│   ├── lab/                   # Content Lab scrapers, metrics, and topic extraction
│   └── demo/                  # Demo company store, synthetic seeds, and time-shift logic
│
├── scripts/                   # CLI Tools, Seeders, and Maintenance Scripts
│   ├── serve.mjs              # Custom server runner for dev, start, and preview modes
│   ├── seed.ts                # Database seed runner script
│   ├── adscout.ts             # Foreplay ad library manual sync tool
│   ├── lab-sync.ts            # Content Lab Apify scraping and sync runner
│   ├── lab-agent.ts           # Autonomous content research agent runner
│   ├── generate-brain-docs.ts # Local markdown brain documentation compiler
│   └── [audit-scripts].mjs    # Automated audits for themes, motion, responsive layout
│
├── tests/                     # Test Suite (Over 360 Vitest test files)
│   ├── smoke.test.ts          # Page render smoke test across all routes
│   ├── smoke-api.test.ts      # API endpoint 200 response smoke test
│   ├── auth.test.ts           # Scrypt hashing and session validation tests
│   ├── auth-gate.test.ts      # Middleware gate decision matrix tests
│   ├── db.test.ts             # SQLite schema and migration tests
│   ├── llm.test.ts            # LLM connector and stub provider tests
│   └── [feature].test.ts      # Comprehensive domain logic unit tests
│
└── public/                    # Static Assets (Images, Icons, Media)
    ├── brand/                 # Brand logos (founderos-mark.png, glados-mark.png)
    ├── agents/                # Pre-configured avatar images for runtime agents
    ├── adpilot/               # 3D globe textures and assets
    └── content-media/         # Generated video assets and ad creatives
```

---

## 4. Database Architecture & Data Storage

### 4.1 Storage Engine: `better-sqlite3`
- **Engine:** SQLite 3 via the synchronous `better-sqlite3` library (`^11.3.0`).
- **Connection Model:** Singleton pattern managed in `lib/data.ts`. Opened on first call and shared across all Server Components, API Route Handlers, and background cron executions.
- **Safety Property (Filming / Demo Isolation):**
  - **Real Workspace:** Stores data under `data/glados.db`.
  - **Demo Workspace:** Stores data under `demo-data/glados.db`.
  - `lib/paths.ts` dynamically resolves the path based on `.glados-mode` or the `GLADOS_DEFAULT_MODE` environment variable. Real records in `data/` are never overwritten by demo seeds.
- **Seed Architecture (`lib/seed.ts`):**
  - Structural seed inserts the 6 primary departments and mirrors the real agent roster.
  - People, tasks, metrics, funnel contacts, and social records start empty for real installations.

### 4.2 Comprehensive Database Schema
The database schema is defined across `lib/db.ts`, `lib/bank.ts`, and `lib/ledger.ts`. Statements use idempotent `CREATE TABLE IF NOT EXISTS` and automatic schema migrations (`migrateFounderOs`, `migrateLabV2`).

```
+---------------------------------------------------------------------------------------------------------+
|                                        SQLite Relational Schema                                         |
+---------------------------------------------------------------------------------------------------------+

  [DEPARTMENTS & ORG]
  ├── departments              (id [PK], name, slug, tagline, color, order)
  ├── people                   (id [PK], department_id [FK], name, role, tools)
  ├── sop_tasks                (id [PK], department_id [FK], title, summary, steps, assignee_kind, assignee_id)
  ├── phases                   (id [PK], number, title, items)
  ├── roadmap_items            (id [PK], title, quarter, status, department_id, description)
  └── metrics                  (id [PK], key [UNIQUE], label, value, unit, delta, period)

  [AGENTS & RUNTIME]
  ├── agents                   (id [PK], department_id [FK], name, role, status, tier, model, tools)
  ├── agent_runs               (id [PK], agent_id, started_at, finished_at, ok, summary)
  ├── agent_messages           (id [PK], agent_id, role, content, tool_calls, created_at)
  ├── broadcasts               (id [PK], message, created_at)
  ├── broadcast_replies        (id [PK], broadcast_id [FK], agent_id, ok, reply, finished_at)
  ├── agent_tasks              (id [PK], agent_id, title, status, created_at, updated_at, priority, owner_kind)
  ├── agent_crons              (id [PK], agent_id, schedule, description, enabled, created_at)
  ├── cron_runs                (id [PK], cron_id, agent_id, started_at, finished_at, ok, summary, trigger)
  └── deliverable_decisions    (run_id [PK], decision, reason, at)

  [KNOWLEDGE & SKILLS]
  ├── skills                   (id [PK], name, category, description, owner_agent_id, status, tools, markdown)
  ├── tools                    (id [PK], name, category, status, color, description)
  ├── workflows                (id [PK], name, subtitle, revenue_usd, ord, steps)
  ├── workflow_versions        (id [PK], workflow_id, version, created_at, note, snapshot)
  └── config_versions          (id [PK], target, version, created_at, note, snapshot)

  [REVENUE, FUNNEL & CLIENTS]
  ├── funnel_contacts          (id [PK], name, venture, status, product, amount_usd, relationship, likelihood, email, phone)
  ├── funnel_touches           (id [PK], contact_id [FK], seq, stage, channel, label, source, at)
  ├── client_confirmations     (client_id [PK], name, company, source, retainer, slack_channel, confirmed_at)
  ├── client_work              (id [PK], client_id, brief, status, superset_workspace, created_at, finished_at)
  ├── lead_magnets             (id [PK], name, offer, live_url, destination, campaign, status, went_live_at)
  ├── brand_deal_overrides     (deal_id [PK], outcome, amount_usd, updated_at)
  └── contact_tags             (person, channel, tag, tier [PK: person, channel])

  [TREASURY, TRADING & LEDGER]
  ├── trading_snapshots        (account_id, captured_at [PK], account_value_usd, buying_power_usd, cash_usd, pnl)
  ├── trading_positions        (account_id, captured_at, symbol [PK], quantity, avg_cost_usd, market_value_usd)
  ├── trading_activity         (id [PK], at, account_id, agent, action, symbol, quantity, price_usd, status)
  ├── trading_analysis         (id [PK], at, account_id, agent, examined, signals, notes, rows_json)
  ├── trading_orders           (id [PK], account_id, symbol, side, type, state, quantity, limit_price_usd)
  ├── trading_limits           (id [PK: CHECK id=1], max_deployed_capital_usd, max_notional_per_trade_usd, autopilot)
  ├── bank_summaries           (id [PK], period, balance_usd, income_usd, expense_usd, captured_at)
  └── ledger_rows              (id [PK], date, description, category, amount_usd, direction, source)

  [COMMS & SOCIAL]
  ├── comms_digests            (id [PK], date, body_json, created_at)
  ├── digest_reads             (digest_id, entry_key [PK], read_at)
  ├── call_recordings          (id [PK], source, external_id, title, started_at, duration_s, summary, transcript_url)
  ├── social_accounts          (platform [PK], handle, url, order)
  ├── social_snapshots         (platform, captured_at [PK], followers, source)
  ├── email_list_snapshots     (captured_at [PK], subscribers, source)
  ├── social_dms               (platform [PK], count, updated_at)
  ├── social_dm_snapshots      (platform, captured_at [PK], count, source)
  ├── social_dm_messages       (id [PK], platform, subscriber_id, name, text, direction, tag, ts, source)
  └── social_posts             (id [PK], caption, media_url, platforms, status, scheduled_for, created_at)

  [SYSTEM & USAGE]
  ├── setup_checks             (id [PK], done_at)
  └── usage_readings           (machine, plan, day, model [PK], input, output, cache_write, pushed_at)

  [CONTENT LAB V2 (25+ tables)]
  ├── lab_sources              (id [PK], platform, handle, kind, status, tracked_since, frequency_hours)
  ├── lab_posts                (id [PK], platform, source_id, external_id, posted_at, caption, url, views)
  ├── lab_post_metrics         (id [PK], post_id, captured_at, views, likes, comments, shares, saves)
  ├── lab_transcripts          (post_id [PK], text, language, source, created_at)
  ├── lab_dissections          (id [PK], post_id, hook, format, structure, tone, angle, pacing)
  ├── lab_ideas                (id [PK], title, premise, hook, format, score, status, created_at)
  ├── lab_scripts              (id [PK], idea_id, title, body, status, created_at)
  ├── lab_events               (id [PK], name, category, status, impact_score, discovered_at)
  ├── lab_predictions          (id [PK], post_id, predictor_id, predicted_score, actual_score, status)
  ├── lab_tests                (id [PK], name, status, kind, arms_json, winner_arm_id)
  ├── lab_embeddings           (id [PK], subject_type, subject_id, vector_json, created_at)
  ├── lab_comments             (id [PK], post_id, text, author, intent, sentiment, score)
  └── lab_spend                (id [PK], provider, line, amount_usd, date, run_id)
```

### 4.3 Data Repositories & Extension Modules
Operations are strictly encapsulated through strongly-typed helper repositories under `lib/db-ext/`:
- `agent-ops.ts`: Manages cron runs and deliverable decision approvals.
- `clients.ts`: Manages client confirmations and project briefs.
- `comms-digest.ts`: Manages daily communication digests and read indicators.
- `lead-magnets.ts`: Manages lead generation funnel configurations.
- `recordings.ts`: Manages Plaud and Fathom audio meeting transcriptions.
- `trading.ts`: Manages portfolio allocations, snapshots, and limits.
- `usage.ts`: Aggregates cross-machine AI token consumption metrics.

---

## 5. Application Modules & Functional Inventory

The application groups its business functions into **6 Primary Navigational Groups** plus dedicated Org and Setup facilities (`lib/nav.ts`):

```
+----------------------------------------------------------------------------------------+
|                               Hazzino BOS Modules Map                                  |
+----------------------------------------------------------------------------------------+
  COMMAND             REVENUE             GROWTH              WORKFORCE
  ├── Home            ├── Funnel          ├── Social          ├── Agents
  ├── Wizard          ├── Brand Deals     ├── AdPilot         ├── Chats
  └── Comms           ├── Clients         ├── Creative Engine ├── Tasks
                      ├── Finances        ├── Analytics       ├── Workflows
                      └── Trading         ├── Content Lab     ├── Skills
                                          └── Lead Magnets    └── Compute

  KNOWLEDGE           SYSTEM              SPECIALIZED
  ├── Optimal Engine  ├── Settings        ├── Org Chart (/org)
  ├── Brain Files     ├── Connections     └── Login Gate (/login)
  ├── Visualizer      ├── Usage Monitor
  └── Drift Detector  ├── Blueprint
                      └── Strategic Roadmap
```

### 5.1 Command Group
1. **Home Console (`/`):** Executive command dashboard (`Home6Console.tsx`). Displays real-time operational status, today's priority items (`NeedsYou`), completed actions (`DoneToday`), multi-channel posting velocity charts, and inbound communications metrics.
2. **Wizard (`/wizard`):** Executive super-agent conversational interface. Acts as a meta-orchestrator delegating high-level operator directives into agent tasks and automated execution blocks (````wizard`).
3. **Comms (`/inbox`):** Unified communication triage dashboard. Consolidates unread emails across 4 IMAP accounts, local WhatsApp chats, Slack channels, and automated daily AI communication digests.

### 5.2 Revenue Group
4. **Funnel (`/funnel`):** Customer acquisition journey tracker. Connects with GoHighLevel and Attio to map touchpoints (first touch, nurture, opt-in, conversion) across organic, paid, and outreach channels.
5. **Brand Deals (`/brand-deals`):** Sponsorship and corporate partnership pipeline. Interfaces with the BDPilot daemon and Telegram bot for inbound sponsor inquiries and approval workflows.
6. **Clients (`/clients`):** High-touch client roster and retainer management. Handles project intake briefs and launches scoped Superset workspaces.
7. **Finances (`/finances`):** Financial command center. Direct Stripe balance sync, manual bank statement PDF/CSV parser, transaction categorization, and double-entry ledger view.
8. **Trading (`/trading`):** Treasury and liquid market asset tracking. Ingests stock and crypto portfolio snapshots from external Markets agents (Robinhood) and public Solana wallets (Phantom) with strict capital limits and kill switches.

### 5.3 Growth Group
9. **Social (`/social`):** Multi-platform audience tracker (Instagram, TikTok, X, YouTube, LinkedIn). Includes an integrated social post composer, ManyChat DM conversation inbox, and Beehiiv newsletter subscriber growth tracking.
10. **AdPilot (`/adpilot`):** Paid media intelligence deck. Displays Meta ad account performance, ad creative velocity, 3D geographic audience distribution globe, and an ad library watchlist.
11. **Creative Engine (`/creative-engine`):** High-volume video advertisement production studio. Connects to Foreplay for ad creative research and Arcads for synthetic UGC actor video generation.
12. **Analytics (`/analytics`):** Cross-business telemetry reporting on operational performance, audience reach, agent task outcomes, and system health.
13. **Content Lab (`/lab`):** Deep organic content laboratory. Uses Apify to scrape viral videos, extract audio transcripts via OpenAI Whisper, dissect structural hooks, score retention patterns, and predict breakout topics.
14. **Lead Magnets (`/lead-magnets`):** Landing page and opt-in campaign management. Tracks lead capture status and conversion destinations.

### 5.4 Workforce Group
15. **Agents (`/agents`):** Autonomous agent operational directory. Inspects agent states (lead, specialist, worker), triggers manual runs, inspects execution summaries, and broadcasts prompts to the entire workforce.
16. **Chats (`/chats`):** Dedicated 1-on-1 direct conversation lines with individual runtime agents, powered by agent-specific system prompts and read-only tool calling.
17. **Tasks (`/tasks`):** Central task Kanban board tracking agent and operator assignments, time horizons (week, month, quarter), and priority schedules.
18. **Workflows (`/workflows`):** Visual automation workflow canvas. Allows the creation, versioning, and execution of multi-step sequential and branching business processes.
19. **Skills (`/skills`):** Skill repository and SOP directory. Maps operational capabilities, markdown instructions, and executable tools to designated owner agents.
20. **Compute (`/compute`):** Cloud infrastructure and desktop environment automation backed by the Miosa SDK.

### 5.5 Knowledge Group
21. **Optimal Engine (`/brain`):** Knowledge search interface powered by G-Brain hybrid search (vector embeddings + keyword BM25).
22. **Brain Files (`/database`):** File explorer and treemap visualization of the local markdown knowledge base repository.
23. **Knowledge Visualizer (`/knowledge`):** Interactive D3 force-directed knowledge graph displaying cross-document conceptual links and load-bearing entities.
24. **Drift (`/drift`):** Knowledge base audit tool detecting logical contradictions and conflicting assertions across canonical notes.

### 5.6 System & Organization Group
25. **Settings (`/setup`):** System configuration console. Manages themes/appearances, operator password security, module toggling, checklist verification, and demo/filming mode.
26. **Connections (`/integrations`):** Integration catalog displaying live connection states for all 30+ external tools and secure API key entry inputs.
27. **Usage (`/usage`):** AI token consumption telemetry. Tracks token burn, dollar expenditures, and model distributions across local and remote machines.
28. **Blueprint (`/blueprint`):** Live architectural map visualizing system layers, domains, databases, and connectors.
29. **Roadmap (`/roadmap`):** Strategic quarterly milestone planner and phase delivery tracker.
30. **Org Chart (`/org`):** Visual departmental hierarchy depicting leads, workers, and human personnel.

---

## 6. Authentication & Authorisation Mechanisms

### 6.1 Gate Architecture (`middleware.ts` & `lib/auth-gate.ts`)
The application implements an **Edge-safe Gatekeeper Pattern**:

```
Client Request
      |
      v
+---------------------------------------------------------------+
|  Edge Middleware (middleware.ts)                              |
|                                                               |
|  1. Is Path Open?                                             |
|     (/login, /api/auth/login, /api/auth/check, webhooks) ----> PASS
|                                                               |
|  2. Is Host Loopback (localhost / 127.0.0.1)?                 |
|     - NO Password Configured & Loopback Host -------------> PASS (Local dev)
|     - NO Password Configured & Remote Host ---------------> 503 Service Unavailable
|                                                               |
|  3. Password Configured?                                      |
|     - Valid Session Cookie (glados_session) --------------> PASS
|     - Invalid/Missing Cookie on Page ----------------------> 302 Redirect to /login
|     - Invalid/Missing Cookie on API -----------------------> 401 Unauthorized
|                                                               |
|  4. Mutating Request (POST/PUT/DELETE)?                       |
|     - Cross-Origin Origin Header mismatch ----------------> 403 Forbidden (CSRF)
+---------------------------------------------------------------+
```

### 6.2 Password Security & Cryptography (`lib/auth.ts`)
- **Hash Algorithm:** `scrypt` key derivation function with parameters `N=16384, r=8, p=1, keylen=32`.
- **Hash Storage Format:** `scrypt:16384:8:1:<salt_hex>:<key_hex>`.
- **Timing Attack Resistance:** Comparisons between provided session secrets and stored hashes use Node.js `crypto.timingSafeEqual`.
- **Session Mechanism:** Single rolling session secret (`GLADOS_SESSION_SECRET`, 64 hex characters) stored in `.env.local` and transmitted via an `HttpOnly`, `SameSite=Lax` cookie (`glados_session`).
- **Global Logout on Password Change:** Changing or setting the password generates a new random session secret, immediately invalidating active sessions across all other devices.

### 6.3 External Agent Push Authentication (`lib/push-auth.ts`)
For external worker nodes or daemon processes pushing data without an interactive browser session, dedicated bearer token paths are exempt from middleware cookie checks (`TOKEN_PATHS`):
- `POST /api/trading/snapshot` (requires `TRADING_PUSH_TOKEN`)
- `POST /api/trading/limits` (requires `TRADING_PUSH_TOKEN` for GET; operator session for PATCH)
- `POST /api/usage/push` (requires `USAGE_PUSH_TOKEN`)
- `POST /api/plaud/ingest` (requires `PLAUD_INGEST_TOKEN`)
- `POST /api/webhooks/manychat` (requires `MANYCHAT_WEBHOOK_SECRET`)

These routes validate the bearer token in constant time using `timingSafeEqual`. If no token is configured on the server, the route fails closed (requiring an operator session).

### 6.4 Current Authorisation Limitations
- **No Multi-User Roles:** The system does not differentiate between Super-Admin, Manager, Employee, or Read-Only Client. Any authenticated session has full administrative privileges over the entire database and all connected services.
- **No Granular Scopes:** API routes do not support scoped permissions or granular access tokens.

---

## 7. AI Integration & Agent Architecture

The AI layer in FounderOS/GladOS is deeply integrated into both direct user interactions and autonomous background workflows:

```
                                    +-----------------------------------------+
                                    |               Operator Chat             |
                                    |        (/chats or /wizard console)      |
                                    +-----------------------------------------+
                                                         |
                                                         v
                                    +-----------------------------------------+
                                    |         Conductor Router (lib/agents)   |
                                    |    - Matches @agent syntax              |
                                    |    - Or LLM-routes based on prompt      |
                                    +-----------------------------------------+
                                                         |
                                    +--------------------+--------------------+
                                    |                                         |
                                    v                                         v
                     +------------------------------+          +------------------------------+
                     |    Vercel AI SDK (lib/llm)   |          |    Local Claude CLI Engine   |
                     |  - Gateway: claude-sonnet-5  |          |  - claude -p <prompt>        |
                     |  - Read-only Tool Execution  |          |  - --output-format json      |
                     |  - Multi-step tool calls (6) |          |  - --resume <sessionId>      |
                     |  - Deterministic Stub Mode   |          |  - Generates ```wizard block |
                     +------------------------------+          +------------------------------+
                                    |                                         |
                                    v                                         v
                     +------------------------------+          +------------------------------+
                     |     Direct Agent Reply       |          |     Project State Mutation   |
                     |   (persisted to DB messages) |          |  (tasks created, agents run) |
                     +------------------------------+          +------------------------------+
```

### 7.1 Agent Runtime Engine (`lib/agents/runtime.ts` & `real.ts`)
- **Runtime Agent Interface:** Each registered agent implements:
  - `id`, `name`, `description`, `departmentId`
  - `run(): Promise<AgentRunResult>`: Synchronous or asynchronous health and diagnostic check.
  - `configured(): boolean`: Verifies whether backing API keys, binaries, or daemons exist.
  - `respond(message): Promise<AgentRunResult>`: Optional entry point for workforce broadcasts.
  - `chatTools(): LlmToolSpec[]`: Defines read-only tools the agent can invoke mid-conversation.
- **Registered Agent Workforce (20+ Agents):**
  - **Executive & Orchestration:** `conductor` (Wizard / Router)
  - **Tech & Infrastructure:** `data-agent` (Optimal Engine / Brain search), `markdown-auditor`, `vector-auditor`, `notion-sync`, `stack-monitor`, `daily-briefing`, `automation-jobs`
  - **Communications:** `comms-agent` (Triage lead), `gmail-worker`, `whatsapp-worker`, `slack-worker`
  - **Revenue & Sponsorships:** `draft-approval-bot`, `inbound-watcher`, `brand-deal-drafter`, `gsend-sender`, `sales-agent`, `crm-pulse`, `deal-scanner`, `deal-alerts`
  - **Marketing & Growth:** `adscout` (Foreplay ad intelligence), `contentLabAgent` (Apify viral content researcher)

### 7.2 Tool-Calling Framework
Agents carry domain-specific read-only tools defined with Zod parameter schemas:
- `adscout`: Carries `brandAdDossier`, allowing the LLM to inspect competitor ad creative velocity and longevity by domain.
- `data-agent`: Carries brain search tools querying local markdown repositories and vector indices.
- **Safety Boundary:** Agents are strictly read-only in conversational mode (`systemPromptFor` explicitly mandates: *"You are READ-ONLY: never claim to have sent, created, scheduled, or published anything"*). State mutations are reserved for explicit operator confirmation.

### 7.3 Multi-Turn Wizard Autonomous Loop (`lib/wizard/*`)
The Wizard allows continuous project planning by interfacing directly with the local `claude` CLI:
- Protocol outputs an embedded, fenced JSON payload:
  ```json
  ```wizard
  {
    "tasks": [{ "title": "Audit marketing funnels", "owner": "sales-agent" }],
    "done": ["Initial repo inspection"],
    "run": ["sales-agent"]
  }
  ```
  ```
- The frontend strips the block from display prose and executes the instructions against the SQLite database, scheduling runs and updating task boards automatically.

---

## 8. API Routes & External Integrations

### 8.1 API Route Directory Summary (120+ Endpoints)
The REST API surface covers all business domains:

| Route Group | Primary Endpoints | HTTP Methods | Purpose |
| :--- | :--- | :--- | :--- |
| **Authentication** | `/api/auth/login`, `logout`, `check`, `password` | GET, POST | Session creation, status checks, password updates |
| **Agent Ops** | `/api/agents`, `[id]/run`, `[id]/chat`, `broadcast`, `deliverables/decision` | GET, POST | Agent execution, conversational chat, team broadcasts |
| **Wizard / Conductor** | `/api/wizard/projects`, `send`, `crew`, `engine`, `/api/conductor/chat` | GET, POST, DELETE | Multi-turn project chat, Claude CLI bridge, routing |
| **Comms & Ingest** | `/api/comms`, `reply`, `digest`, `/api/plaud/ingest` | GET, POST | Unified message stream, email dispatch, recording intake |
| **Revenue & Sales** | `/api/funnel`, `lead-message`, `/api/brand-deals`, `override`, `send`, `rules` | GET, POST, PATCH | CRM lead updates, sponsorship tracking, email sending |
| **Clients** | `/api/clients`, `confirm`, `work`, `work/[id]/launch` | GET, POST, PATCH | Client onboarding, brief tracking, Superset launching |
| **Finances & Trading** | `/api/finances/statements`, `/api/trading`, `snapshot`, `limits` | GET, POST, PATCH | Statement parsing, portfolio snapshots, capital limits |
| **Creative Engine** | `/api/creative-engine/campaigns`, `briefs`, `scripts`, `arcads/*`, `runs` | GET, POST, DELETE | UGC video generation, actor catalog, script workflows |
| **Content Lab** | `/api/lab/sources`, `posts`, `ideas`, `scripts`, `radar`, `tests`, `ledger` | GET, POST, PATCH | Viral video scraping, hook extraction, cost tracking |
| **Social** | `/api/social`, `posts`, `sync`, `upload`, `dm/reply`, `/api/webhooks/manychat` | GET, POST | Social analytics, post scheduling, ManyChat DMs |
| **Knowledge & Brain** | `/api/brain`, `graph`, `dump`, `/api/database/file` | GET, POST | Brain search, graph structure export, raw file reads |
| **System & Setup** | `/api/setup/check`, `/api/settings/modules`, `filming`, `/api/connections` | GET, POST | System checks, module enable/disable, key testing |
| **Usage & Telemetry**| `/api/usage`, `push`, `/api/metrics`, `/api/cron/tick`, `/api/cron/run` | GET, POST | Token usage ingestion, operating metrics, cron engine |

### 8.2 External Integrations Matrix
The application integrates with **30 external services and platforms**:

```
+----------------------------------------------------------------------------------------------------+
|                                    External Integrations Matrix                                    |
+----------------------------------------------------------------------------------------------------+

  [COMMUNICATION & PRODUCTIVITY]
  ├── Email (IMAP)             --> Inboxes 1–4 via imapflow (Gmail App Passwords, custom IMAP)
  ├── Email (SMTP)             --> Outbound email replies via nodemailer
  ├── Slack                    --> Channel history & messaging via @slack/web-api
  ├── WhatsApp                 --> Local macOS ChatStorage reader + Meta WhatsApp Business Cloud API
  ├── Notion                   --> Internal knowledge syncing via @notionhq/client
  ├── iCal Calendar            --> Schedule reading via node-ical
  └── Fathom & Plaud           --> Meeting recordings and transcription webhook intake

  [FINANCES & TREASURY]
  ├── Stripe                   --> Balance and transaction ledger via stripe SDK
  ├── PayPal                   --> REST API integration for payments
  ├── Square, Whop, FanBasis   --> Creator earnings & digital product sales monitoring
  ├── Wise                     --> Bank balance and transfer monitoring
  ├── Robinhood                --> Stocks and portfolio telemetry via Markets agent push
  └── Solana / Phantom         --> Public wallet balance tracking via Solana JSON-RPC

  [SALES, CRM & ATTRIBUTION]
  ├── GoHighLevel (GHL)        --> CRM contacts, pipelines, and location sub-accounts
  ├── Attio                    --> Relationship intelligence and deal tracking
  ├── Trakyo                   --> Marketing link attribution and conversion tracking
  └── WebinarJam               --> Webinar registrations and attendee tracking

  [MARKETING, SOCIAL & CONTENT]
  ├── Meta Ads & Instagram     --> Instagram Insights OAuth, Meta Graph API, ManyChat webhook
  ├── YouTube                  --> Google Cloud OAuth 2.0 & YouTube Analytics API
  ├── Beehiiv                  --> Newsletter publication metrics and subscriber growth
  ├── Apify                    --> Social media scraping actors (TikTok, Instagram, X)
  ├── Foreplay                 --> Ad creative library research and brand dossiers
  └── Arcads                   --> Synthetic UGC actor video rendering and motion generation

  [AI, COMPUTE & SEARCH]
  ├── Vercel AI Gateway        --> Multi-model routing (Claude Sonnet, OpenAI, etc.)
  ├── OpenAI                   --> Whisper speech-to-text audio transcription and embeddings
  ├── Miosa SDK                --> Cloud desktop environment automation (@miosa/sdk)
  ├── G-Brain CLI              --> Local hybrid markdown search (ZeroEntropy + Supabase)
  └── Superset                 --> Automated client workspace container launching
```

---

## 9. Testing, Build, & Automation Workflow

### 9.1 Package Scripts & CLI Commands
The project defines standard development and operational commands in `package.json`:

```bash
# Development & Production Serving
npm run dev                  # Start Next.js development server via scripts/serve.mjs
npm run build                # Execute next build production compilation
npm start                    # Start production server on existing build
npm run preview              # Compile into isolated .next-preview and serve (user-experience review)

# Verification & Quality Assurance
npm test                     # Run all Vitest test suites (vitest run)
npm run test:watch           # Run Vitest in interactive watch mode
npm run typecheck            # Run TypeScript typecheck without emitting code (tsc --noEmit)

# Database & Brain Operations
npm run seed                 # Execute database seeder (tsx scripts/seed.ts)
npm run brain:docs           # Generate local markdown brain documentation

# Specialized Scrapers & Agents
npm run adscout              # Run Foreplay ad library manual sync cycle
npm run lab-sync             # Execute Apify viral content scraper sync
npm run lab-agent            # Run autonomous content research agent
npm run lab-e2e              # Execute end-to-end dry run of Content Lab pipeline
```

### 9.2 Testing Framework (`vitest.config.ts`)
- **Engine:** Vitest 2.1.1 executing in a Node.js environment.
- **Hermetic Testing Isolation:**
  - `GLADOS_ENV_LOCAL`: Injected with a non-existent path during tests to prevent tests from ever reading or mutating the operator's real `.env.local`.
  - `GLADOS_MODE_FILE`: Points to a hermetic dummy file so test suites default to `real` mode without reading the operator's mode switch.
  - `CREATIVE_ENGINE_MIGRATE='0'`: Prevents filesystem asset migrations from running against disk during testing.
- **Key Test Categories:**
  - `smoke.test.ts`: Verifies that every single page in `app/` mounts and renders cleanly.
  - `smoke-api.test.ts`: Verifies that every GET route answers with HTTP 200.
  - `setup-links.test.ts`: Enforces the "Honest or Absent" rule—asserting that unconfigured integrations display setup links rather than fake metrics.
  - `revenue-honesty.test.ts` & `workforce-honesty.test.ts`: Enforces that financial and agent states cannot report simulated numbers in real mode.

---

## 10. Security Assessment & Production Limitations

### 10.1 Security Vulnerabilities & Attack Vectors
1. **Plaintext Secrets in `.env.local`:**
   - All third-party API keys, OAuth refresh tokens, and payment secrets are stored as plaintext values in `.env.local`. While protected with file mode `0600`, any host process compromise exposes all business credentials.
2. **Local Subprocess Execution (`child_process.execFile`):**
   - The app directly spawns system binaries (`claude`, `gbrain`, `gsend`, `superset`, `ffmpeg`, `ffprobe`). While `execFile` avoids direct shell command injection compared to `exec`, unsanitized input passed to flags or arguments represents a potential privilege escalation risk.
3. **Unauthenticated Push Endpoints if Keys are Omitted:**
   - Webhook and push endpoints rely on shared bearer tokens (`USAGE_PUSH_TOKEN`, `TRADING_PUSH_TOKEN`, `PLAUD_INGEST_TOKEN`, `MANYCHAT_WEBHOOK_SECRET`). If an operator fails to set these in `.env.local`, the server fails closed for external IPs but allows loopback callers, which can be spoofed in misconfigured proxy environments.
4. **Single Shared Session Secret:**
   - All authenticated sessions share the exact same `GLADOS_SESSION_SECRET`. Session revocation is all-or-nothing (rotating the secret logs out all devices simultaneously).

### 10.2 Architectural & Production Limitations
1. **Single-User / Personal OS Paradigm:**
   - FounderOS was built for a solo entrepreneur ("command center for a one-person company"). There are no database foreign keys linking tasks, deals, or records to specific user accounts or organizational tenants.
2. **SQLite Concurrency & Multi-Worker Locking:**
   - `better-sqlite3` is a synchronous, file-based driver. In multi-instance deployments (e.g., containerized Kubernetes pods or serverless functions), SQLite cannot handle distributed writes without encountering `SQLITE_BUSY` database locks.
3. **Local Desktop & macOS Coupling:**
   - Features like local WhatsApp ChatStorage reading, transcript inspection in `~/.claude/`, and daemon state inspection in `~/.config/bdpilot/` cannot operate in standard Linux cloud containers (AWS ECS, Google Cloud Run, Vercel) without significant re-engineering or cloud-native replacements.
4. **In-Memory Cache Volatility:**
   - The SWR cache (`lib/swr.ts`) lives entirely within Node.js process memory (`Map<string, Entry>`). Restarting the server clears all cached third-party statuses.

---

## 11. Reusable Components for Hazzino BOS

The following existing subsystems and components provide an exceptional foundation for Hazzino BOS and can be directly leveraged without architectural rework:

| Existing Component | Location | Capability / Purpose in Hazzino BOS |
| :--- | :--- | :--- |
| **Master Navigation & Shell** | `components/Sidebar.tsx`, `Topbar.tsx`, `lib/nav.ts` | Fully responsive navigation rail, ⌘K command palette, and breadcrumb system |
| **Multi-Accent Design System** | `lib/theme.ts`, `lib/appearance.ts`, `app/globals.css` | Enterprise-grade dark/light styling, CSS variable tokens, and Geist typography |
| **Brand Customization Hook** | `lib/brand.ts` | Centralized branding definition (`BRAND.name`, `title`, `mark`) that cascades to all pages |
| **Agent Runtime & Orchestration** | `lib/agents/runtime.ts`, `chat.ts`, `conductor.ts` | Ready-made multi-agent execution framework with read-only tool calling |
| **Wizard Autonomous Loop** | `lib/wizard/*`, `components/wizard/*` | Meta-agent orchestration engine parsing structured ````wizard execution blocks |
| **Revenue & Funnel Pipeline** | `app/funnel`, `lib/funnel.ts`, `components/funnel/*` | Complete customer journey tracking, conversion attribution, and contact stage management |
| **Client Work & Brief Workspace**| `app/clients`, `lib/clients-data.ts`, `components/clients/*`| Client roster, retainer tracking, brief intake, and project delivery boards |
| **Financial Treasury & Ledger** | `app/finances`, `lib/finances.ts`, `components/finances/*` | Stripe payment integration, double-entry ledger view, and bank statement parser |
| **Task Management Kanban** | `app/tasks`, `components/tasks/*` | Multi-lane Kanban board with agent workload metrics, time horizons, and schedules |
| **Visual Workflow Canvas** | `app/workflows`, `components/workflow-canvas/*` | Drag-and-drop node graph canvas for designing sequential and branching automations |
| **Knowledge Graph & Brain** | `app/knowledge`, `app/brain`, `components/KnowledgeGraph.tsx`| D3 force-directed semantic knowledge visualizer and document retrieval system |
| **Module Gating Architecture** | `lib/modules.ts`, `components/ModuleGate.tsx` | Ability to switch entire functional modules on or off without altering database schema |

---

## 12. Recommended Customisation Roadmap for Hazzino BOS

To transition this codebase cleanly from FounderOS/GladOS into the **Hazzino Business Operating System (Hazzino BOS)**, the following phased roadmap is recommended:

```
  PHASE 1: Foundation & Baseline Alignment
  ├── Install dependencies (Node 22 LTS, npm ci)
  ├── Verify clean baseline (npm run typecheck, npm test)
  └── Establish local environment documentation

  PHASE 2: Brand & Identity Overhaul
  ├── Add Hazzino BOS brand entry in lib/brand.ts
  ├── Replace brand marks in public/brand/ (hazzino-mark.png)
  ├── Configure default UI style to 'glados' with custom Hazzino accent palette
  └── Update document titles, headers, and metadata across the shell

  PHASE 3: Modular Configuration & Tailoring
  ├── Review 30 modules against Hazzino BOS requirements
  ├── Disable irrelevant personal modules via lib/modules.ts (e.g. personal Trading sleeve)
  ├── Re-label navigation groups to align with Hazzino business terminology
  └── Update structural departments and agent roster in lib/seed.ts

  PHASE 4: Multi-User & Enterprise Access Control (RBAC)
  ├── Design multi-tenant organizational structure
  ├── Introduce User entity with role levels (Super Admin, Executive, Staff, Client)
  ├── Migrate single scrypt session secret to JWT or database session management
  └── Implement role-based middleware guards on protected API routes

  PHASE 5: Cloud Migration & Decoupling
  ├── Abstract local CLI dependencies (claude CLI -> Vercel AI SDK / Anthropic API)
  ├── Replace local WhatsApp SQLite reader with Meta Cloud API webhook
  ├── Decouple G-Brain local binary with cloud vector storage (pgvector / Supabase)
  └── Containerize application with Docker for cloud deployment (AWS ECS / GCP Cloud Run)

  PHASE 6: Hazzino Specialized Multi-Agent Workforce
  ├── Implement dedicated Hazzino business domain agents in lib/agents/real.ts
  ├── Author custom operational SOPs and skills in lib/skills-catalog.ts
  └── Connect Hazzino core external ERP, CRM, and communication tools
```

### Detailed Phase Milestones

#### Phase 1: Foundation & Baseline Alignment
- Ensure development machines use **Node.js 22 LTS**.
- Run `npm ci` to establish the initial `node_modules` directory.
- Verify that `npm run typecheck` and `npm test` execute with zero errors to guarantee a pristine baseline before any customization begins.

#### Phase 2: Brand & Identity Overhaul
- Update `lib/brand.ts` to include `'hazzino'` as the primary brand:
  ```typescript
  hazzino: { id: 'hazzino', name: 'Hazzino BOS', title: 'HAZZINO BOS', mark: '/brand/hazzino-mark.png' }
  ```
- Supply vector and high-resolution PNG brand marks in `public/brand/`.
- Update `next.config.mjs` to inline `GLADOS_BRAND=hazzino` by default.
- Set the default UI style in `lib/appearance.ts` to `glados` with Hazzino brand colors.

#### Phase 3: Modular Configuration & Business Tailoring
- Utilize `lib/modules.ts` to disable modules that may not be required for Hazzino BOS operations (such as personal `/trading` or consumer `/brand-deals`).
- Customize the six core operating departments in `lib/seed.ts` (e.g., Executive, Operations, Sales & Partnerships, Engineering, Client Success, Finance).
- Align the real agent roster (`lib/agents/real.ts`) to match Hazzino's actual operational roles.

#### Phase 4: Multi-User & Enterprise Access Control (RBAC)
- Replace the single-operator `.env.local` password authentication with a persistent `users` table in SQLite.
- Introduce permission roles:
  - `Admin`: Full configuration, API keys, workforce and financial controls.
  - `Operator`: Day-to-day task execution, client management, and agent chat.
  - `Viewer / Client`: Read-only access to scoped project delivery boards.
- Upgrade `middleware.ts` to enforce route-level RBAC checks.

#### Phase 5: Cloud Migration & Decoupling
- Replace local desktop CLI dependencies (`claude` CLI, `gsend`, `gbrain`) with direct API SDK calls so the application can run in headless cloud containers without requiring local desktop software.
- Replace local macOS WhatsApp SQLite inspection with the official Meta WhatsApp Business Cloud Webhook API.
- Prepare a standard production `Dockerfile` with multi-stage builds.

#### Phase 6: Hazzino Specialized Multi-Agent Workforce
- Develop custom tools for Hazzino's proprietary business workflows within `lib/agents/real.ts`.
- Populate the Skills library (`/skills`) with Hazzino's internal Standard Operating Procedures (SOPs).
- Connect production credentials in `.env.local` for required communication, payment, and analytics platforms.

---

## 13. Audit Conclusion & Next Steps

The existing repository is an exceptionally sophisticated, well-architected, and battle-tested foundation. It combines modern UI engineering, deep design system tokens, comprehensive testing, and advanced autonomous agent orchestration.

Because the project strictly adheres to separation of concerns (`data/` vs `demo-data/`, `lib/brand.ts` brand abstraction, `lib/modules.ts` module toggling, and Zod data validation), **customizing FounderOS into Hazzino BOS can be accomplished cleanly without breaking architectural integrity.**

### Immediate Next Step
When ready to begin Phase 1:
1. Ensure the development environment is running **Node.js 22 LTS**.
2. Run `npm ci` to install project dependencies.
3. Run `npm run typecheck` and `npm test` to establish the verified baseline before implementing any code modifications.

