# FinTrack

FinTrack is a responsive personal-finance application with account-linked transactions, balance and net-worth history, debt payoff tracking, recurring budgets and obligations, subscriptions, bank imports, household governance, live analytics, and an OpenRouter-powered financial analyst.

## Stack

- Next.js 16, React 19, and TypeScript
- PostgreSQL 17 and Prisma ORM 7
- Clerk authentication with household role enforcement
- NVIDIA Nemotron through OpenRouter and Vercel AI SDK for ephemeral financial analysis
- Zod request validation
- Recharts and Lucide icons
- Docker Compose for local PostgreSQL

## Local Setup

```powershell
npm install
docker compose up -d --wait postgres
npm run db:migrate -- --name init
npm run dev
```

Open `http://localhost:3000`. Database readiness is exposed at `http://localhost:3000/api/health`.

The checked-in `.env.example` contains the local Docker connection string. Create an ignored `.env` with the same value for a new checkout.

Local development without Clerk credentials creates `alex@northstar.local` as an owner of the existing demo household. Production fails closed unless both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are configured. Add Clerk through the Vercel Marketplace, then copy the generated values into the deployment environment. Authenticated users are linked to an internal user record and receive an owner household on first sign-in.

For local API integration tests while Clerk keys are present, start the development server with `FINTRACK_DEVELOPMENT_AUTH=true`. This switch is ignored outside development.

In managed Windows environments where Prisma reports `unable to get local issuer certificate`, preserve TLS verification and use the Windows certificate store:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run db:generate
```

## Database Commands

```powershell
npm run db:generate
npm run db:migrate -- --name <migration-name>
npm run db:studio
docker compose down
```

Database data remains in the `northstar_postgres` Docker volume when containers stop.

## Product API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Database readiness |
| `GET` | `/api/transactions` | Cursor-paginated search and filtering |
| `POST` | `/api/transactions` | Create a validated transaction |
| `PATCH` | `/api/transactions/:id` | Update a transaction |
| `DELETE` | `/api/transactions/:id` | Soft-delete a transaction |
| `POST` | `/api/transactions/import` | Idempotent bulk import, up to 1,000 records |
| `GET` | `/api/budgets?month=YYYY-MM` | List monthly budgets with live spending |
| `POST` | `/api/budgets` | Create or update a category budget |
| `DELETE` | `/api/budgets/:id` | Delete a category budget |
| `GET` | `/api/goals` | List household savings goals |
| `POST` | `/api/goals` | Create a savings goal |
| `PATCH` | `/api/goals/:id` | Update a goal or its saved amount |
| `DELETE` | `/api/goals/:id` | Delete a savings goal |
| `GET/POST` | `/api/households` | List or create households |
| `POST` | `/api/households/switch` | Select an authorized household |
| `POST` | `/api/households/invitations` | Create a seven-day invitation |
| `PATCH/DELETE` | `/api/households/members/:id` | Change roles or remove a member |
| `GET/PATCH` | `/api/settings` | Manage profile and alert preferences |
| `GET` | `/api/notifications` | List personal household notifications |
| `POST` | `/api/notifications/read-all` | Mark notifications read |
| `GET` | `/api/transactions/trash` | List soft-deleted transactions |
| `POST` | `/api/transactions/:id/restore` | Restore a deleted transaction |
| `GET/POST` | `/api/financial-position` | Track accounts, liabilities, and recurring obligations |
| `PATCH/DELETE` | `/api/financial-position/:kind/:id` | Update or delete a financial-position record |
| `POST` | `/api/analysis` | Run a household-scoped Nemotron analysis and optional chart |
| `POST` | `/api/transactions/transfer` | Create an atomic account transfer |
| `GET/POST` | `/api/financial-position/history` | Read or capture net-worth history |
| `GET/POST` | `/api/liabilities/:id/payments` | Payoff projection and debt payments |
| `GET/POST` | `/api/recurring-patterns` | Review or detect recurring activity |
| `GET/POST/PUT` | `/api/reminders` | Manage and generate due reminders |
| `GET/POST` | `/api/budget-templates` | Manage recurring budget rules |
| `POST` | `/api/budgets/rollover` | Carry budgets into a new month |
| `GET/POST` | `/api/goals/:id/contributions` | Goal contribution history |
| `GET/POST` | `/api/subscriptions` | Subscription and renewal management |
| `GET/POST` | `/api/bank-connections` | Provider-neutral bank connection metadata |
| `POST` | `/api/bank-connections/:id/sync` | Import normalized bank transactions |
| `GET` | `/api/audit-logs` | Household audit history |
| `POST` | `/api/account/export` | Download a household JSON export |
| `GET/POST/PATCH` | `/api/account/governance` | Deletion and ownership-transfer workflows |
| `GET` | `/api/cron/maintenance` | Generate budgets/reminders and execute due deletion requests |

Create, update, delete, and import operations write audit records, including the authenticated actor, in the same database transaction as the product mutation. Household viewers can read data; owners, admins, and members can mutate it.

Mutation endpoints require a same-origin browser request and use PostgreSQL-backed per-user rate limits. Set `APP_URL` to the public application origin in each deployed environment.

## Financial Analyst

Set `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` to enable the FinTrack Analyst. The configured model is `nvidia/nemotron-3-ultra-550b-a55b:free`; OpenRouter free-model availability and rate limits can change. The agent can inspect up to 100 raw transactions when record-level context is necessary, and it can analyze up to 100 tracked accounts, liabilities, and recurring obligations per request. Every model-visible database string is treated as untrusted data. The model cannot generate or execute SQL; all access goes through fixed, household-scoped Prisma tools.

Questions, answers, and generated chart specifications remain only in React memory. They are not written to PostgreSQL, local storage, cookies, URLs, or browser databases, and they clear when the analyst closes, the page refreshes, the household changes, or the tab closes.

Relevant financial data is sent through OpenRouter to the selected model provider. Configure OpenRouter and model-provider data-retention controls according to your privacy requirements before production use.

Bank synchronization is provider-neutral: FinTrack stores connection metadata and normalized sync cursors, never bank credentials. A production Plaid, TrueLayer, or regional open-banking adapter must exchange credentials in its own managed secret store and submit normalized transactions to the sync endpoint.

Account deletion uses a seven-day grace-period request. Household owners must transfer ownership before scheduling deletion.

`vercel.json` schedules the maintenance endpoint daily at 09:00 UTC. Configure `CRON_SECRET` so only the scheduler can invoke it.

Account balances use an opening balance plus active linked income minus active linked expenses. Editing, deleting, restoring, importing, or transferring linked transactions reconciles balances and captures net-worth snapshots atomically. Changing the household currency changes display and future interpretation; it does not convert historical numeric amounts.

## Authentication Boundary

Route handlers resolve the active household from a membership-validated HTTP-only cookie and never accept an unverified household ID from the caller. Users can switch among households where they hold a membership.

The browser store is an offline fallback. When PostgreSQL is reachable, existing local transactions migrate using deterministic external IDs and subsequent changes use the API.
