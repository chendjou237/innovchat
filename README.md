# Innovcare — notifications WhatsApp pour l’école

Implementation of **SRS v1.1 — School WhatsApp Notification & Communication System**: a French, single-role administrator dashboard. It records attendance anomalies, per-student fees and calendar events, and turns them into Meta-approved WhatsApp template messages to parents through the WhatsApp Cloud API.

| Part | Stack | Where |
|---|---|---|
| API (REST `/api/v1`, webhook) | NestJS 11, Prisma 6, PostgreSQL 16 | `apps/api` (`src/main.ts`) |
| Worker (queues, scheduler, retries) | BullMQ on Redis 7 (AOF) | `apps/api` (`src/worker.ts`) |
| Dashboard | React 19, Vite, TanStack Query, Tailwind 4 | `apps/web` |
| Shared types, validation, phone/time helpers | zod | `packages/shared` |

## Local development

Requires Node ≥ 22, pnpm ≥ 10 and Docker.

```bash
pnpm install
```

```bash
pnpm dev:infra
```

This starts Postgres on port 5433 and Redis on port 6380. Then create `apps/api/.env` from `apps/api/.env.example` and generate the two keys with `openssl rand -base64 32`.

```bash
cd apps/api && npx prisma migrate deploy && pnpm build && pnpm seed
```

Then run each of these in its own terminal:

```bash
pnpm dev:api
```

```bash
pnpm dev:worker
```

```bash
pnpm dev:web
```

Open http://localhost:5173 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. With `SEED_SAMPLE_DATA=true`, the seed creates the 2026-2027 year, 10 classes, 80 students and two installments.

### WhatsApp provider

- `WHATSAPP_PROVIDER=mock` (default in development): nothing leaves the machine. The mock returns fake `wamid`s and posts signed status webhooks (sent → delivered → read) back to the API. The last 4 digits of a number inject failures:
  - `0000`: not on WhatsApp (permanent)
  - `0001`: invalid parameter (permanent)
  - `0002`: rate limit on every attempt, then failure after 3 retries
  - `0003`: server error once, then success
  - `0004`: accepted, then a "failed" webhook
- `WHATSAPP_PROVIDER=graph`: the real Cloud API (`POST /{phone-number-id}/messages`, Graph version from `META_GRAPH_VERSION`). Credentials are entered in **Paramètres → Connexion WhatsApp** and stored encrypted.

## Tests

```bash
pnpm --filter @innovcare/shared test
```

This runs the unit tests: phone normalisation, the status machine, the Meta error classifier and time-zone maths.

```bash
pnpm --filter @innovcare/api test
```

This runs the integration tests against the `innovcare_test` database, which is created automatically, with the mock provider. It covers:
- the six use cases UC-01 … UC-06
- webhook signature and verification
- idempotency (no double send) and recovery
- the daily limit
- security (lockout, CSRF, encryption, secrets, audit, erasure)
- year-end promotion

The suite refuses to run against a database whose name does not end in `_test`.

## Production (single VPS, Docker Compose)

1. Point a DNS name at the server and open ports 80 and 443.
2. `cp .env.example .env` and fill it in: `DOMAIN`, `POSTGRES_PASSWORD`, `BACKUP_PASSPHRASE`, `ENCRYPTION_KEY`, `PHONE_HASH_KEY`, and the first admin.
   **Keep a copy of `ENCRYPTION_KEY` and `PHONE_HASH_KEY` with the backup passphrase.** Without them, the parent numbers in the backups cannot be read.
3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

   - **caddy** serves the dashboard and proxies `/api` to the API. It obtains and renews the HTTPS certificate automatically.
   - **api** applies migrations and seeds the first admin and the default templates on start (idempotent).
   - **worker** sends messages, runs the scheduler every 15 s and the recovery sweep every minute, and syncs templates every 6 h.
   - **postgres** and **redis**: Redis keeps an append-only file so queued jobs survive restarts.
   - **backup** runs an encrypted `pg_dump` every day at 02:00 into `./backups`, kept 30 days.
4. Sign in, change the admin password, and fill in **Paramètres** (school name and phone, WhatsApp connection, prices per category, daily limit of the number's tier).
5. **Test a restore before go-live** (NFR-16):

   ```bash
   docker compose run --rm -e PGDATABASE=restore_test backup sh -c 'createdb restore_test && /restore.sh /backups/<file>.sql.gz.gpg'
   ```

### Meta / WhatsApp setup

1. In Meta Business Manager, verify the business, add the WhatsApp number and a payment method, and create a **system user** with a permanent token (`whatsapp_business_messaging`, `whatsapp_business_management`).
2. In WhatsApp Manager, create the five default templates in **French (`fr`)** with exactly these names and bodies. The seed holds the reference text, which you can also see under **Modèles**. Submit the absence, tardiness, fee and calendar templates as **Utility**. Meta may classify the general announcement as **Marketing**.

   | Name | Usage |
   |---|---|
   | `retard_eleve` | Tardiness |
   | `absence_eleve` | Absence |
   | `rappel_frais` | Fee reminder |
   | `evenement_ecole` | Calendar event |
   | `annonce_generale` | General announcement |

3. In the Meta app, set the webhook to `https://<DOMAIN>/api/v1/webhooks/whatsapp` with the verify token from **Paramètres**, then subscribe to `messages`. Enter the app secret in **Paramètres**: every webhook POST is checked against `X-Hub-Signature-256`.
4. In **Modèles**, click **Synchroniser avec Meta**. Only templates with status *Approuvé* can be sent.
5. Set the number's WhatsApp profile description to say that replies are not read and to give the school's phone number (§6.4).

## How it maps to the SRS

| SRS | Implementation |
|---|---|
| §3.1 School setup | `org/` and the **Structure** screen. A partial unique index enforces one active year. |
| §3.2 Students and parents | `students/`. Phones are normalised to E.164, encrypted (AES-256-GCM), and searchable through a keyed HMAC. |
| §3.3 Bulk import | `imports/`. The whole file is validated first, then previewed as create / update / error, committed, and the error rows are offered as an Excel download. |
| §3.4 Year-end promotion | `promotions/`. One transaction; history stays on the previous enrolments. |
| §3.5 Attendance | `attendance/`. Each anomaly creates a draft dispatch (`AWAITING_CONFIRMATION`); confirmation is a separate step. |
| §3.6 Calendar | `calendar/`. Each trigger creates one scheduled dispatch. Editing an event moves its dispatches; deleting cancels them. |
| §3.7 Fees | `fees/`. Installments with per-class amounts, individual overrides, payments, unpaid-only reminders and rules (off by default). |
| §3.8 Templates | `templates/`. Meta sync, `parameter_map`, preview. |
| §3.9 Recipient filter | `recipients/`. Union of levels, exclusions and opt-outs, resolved again at send time. |
| §3.10 Scheduling | The worker's scheduler tick (≤ 15 s); scheduled dispatches are editable until processing starts. |
| §3.11 Delivery | `delivery/`. Forward-only statuses; retries after 1, 5 and 30 min; grouped failure notification; resend with a corrected number. |
| §3.12 Cost | Prices per category, an estimate before every dispatch, and a monthly report under **Paramètres → Coûts**. |
| NFR-07/08 | Persistent BullMQ jobs and recovery sweep, plus a unique `(dispatch, student, contact)` key and a send lock per message. |
| NFR-10/11/13 | bcrypt cost 12, 8 h sliding Redis sessions, lockout after 5 failures, CSRF header, HTTPS through Caddy. |
| NFR-14/15/16 | Per-student export and erase, an `audit_log` table, encrypted daily backups. |

Choices the SRS left open:
- A discarded alert is a `CANCELLED` dispatch with its reason.
- Large sends past the tier's daily limit resume the next morning at 07:00.
- Phone numbers on `MESSAGE` rows are also encrypted.
