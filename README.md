# MessMate — Smart Mess & Shared Housing Management Platform (Backend)

A REST API for the monthly accounts of a shared mess. Members record daily
meals, the manager records groceries and utility bills, and at month end the
system computes every member's share and lets them settle it through **bKash**.

Built for Programming Hero **B7A6** (Assignment 6) — backend only.

**Live API:** <https://messmatebackend.vercel.app> · **[API Reference](docs/API.md)** · **[Postman collection](postman/MessMate.postman_collection.json)**

Our own 8-person mess in Chattogram keeps this ledger by hand every month: who
ate how many meals, who did the grocery run, who paid the gas and electricity
bill, and who owes what at the end. MessMate turns that notebook into an API.

---

## Demo Credentials

| Role | Email | Password |
| --- | --- | --- |
| `ADMIN` | `admin@messmate.app` | see `.env` |
| `MESS_MANAGER` | `manager@messmate.app` | see `.env` |
| `MEMBER` | `member@messmate.app` | see `.env` |

Seeded at server boot by `src/app/utils/seed.ts`.

---

## Tech Stack

| Tech | Purpose |
| --- | --- |
| Node.js + Express 5 | REST API |
| TypeScript (strict, ESM) | Type safety |
| PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) | Database + ORM |
| JWT + bcryptjs | Auth + password hashing |
| Google Identity (`google-auth-library`) | GCP social login |
| Zod | Request validation |
| Redis | bKash token cache, OTP state, read cache, rate-limit counters |
| bKash Tokenized Checkout | Payment |
| Nodemailer + EJS | OTP and password-reset emails |
| Cloudinary + Multer | Avatars and expense receipts |
| tsup | Bundles the serverless entry |
| Biome | Lint + format |

---

## The Three Roles

| Role | Can do |
| --- | --- |
| **ADMIN** | Platform operator. All messes and users, role changes, block/unblock, audit logs, dashboard stats, force-reopen a closed cycle. Not a resident of any mess. |
| **MESS_MANAGER** | Owns messes. Members, meals, expenses, deposits, grocery-duty bookings, and closing the month — for their own messes only. |
| **MEMBER** | Declares their own meal plan and pays their own bill. Reads the shared ledger: meals, expenses, deposits and duty for the whole mess. |

Authorization is two layers. `auth(...)` checks the account type;
`checkMessAccess` checks that the mess belongs to the caller. Any route taking a
`messId` needs both, or manager B could edit manager A's ledger with a valid
token.

The manager is also a resident — they eat the meals, take their turn at the
grocery run, and get a bill. So `checkMessAccess` returns the manager's own
`MessMember` row; only `ADMIN` gets `null`.

---

## How the Settlement Works

```
totalMeals    = Σ (lunch + dinner)              over the cycle
groceryTotal  = Σ amount  where type = GROCERY
mealRate      = groceryTotal / totalMeals       e.g. 9000 / 480 = ৳18.75

per member:
  mealCost    = meals × mealRate
  sharedCost  = gas + electricity + water + internet + maid, split EQUAL or BY_MEAL
  rentShare   = monthlyRent × daysPresent / daysInMonth      (prorated)
  credit      = deposits + expenses this member personally paid
  due         = mealCost + sharedCost + rentShare − credit
```

`GROCERY` is excluded from `sharedCost` because it is already inside `mealRate`;
counting it twice would charge for the groceries twice. `RENT` is prorated by
tenure, so someone who joined mid-month pays only for the days they were there.

A negative `dueAmount` is kept as-is — it means the mess owes the member, because
they paid for more groceries than they ate.

**Rounding invariant:** the sum of every member's `mealCost` equals
`groceryTotal` exactly. Shares are rounded down and the remainder allocated
deterministically.

`pnpm check:settlement` runs 20 assertions over the pure function, no database
needed.

---

## Domain Rules

**Meals are declared the night before.** A member sets their calendar in advance:
which days they eat, and which of lunch and dinner. The plan for the 4th must be
in by **11 PM Dhaka time on the 3rd**. Whoever has the grocery duty shops against
tomorrow's headcount, so a plan that can change at noon is not usable. The server
runs in UTC, so the cutoff uses an explicit Dhaka offset rather than the machine
clock.

**The plan and the register are readable by the whole mess.** Grocery duty
rotates, so the person shopping on the 10th needs to see that only 5 of 8 are
eating that day.

**Grocery duty is a booking.** The manager picks one member and a date range of
any length — four days for one person, six for the next. There is no
"generate the month" step; the calendar view is that data read back day by day,
and `my-duty-days` totals what each person did.

---

## Database

11 models, one per schema file under `prisma/schema/`:

`User` · `Mess` · `MessMember` · `BillingCycle` · `MealEntry` · `Expense` ·
`Deposit` · `GroceryDuty` · `MemberBill` · `Payment` · `AuditLog`

| Constraint | Prevents |
| --- | --- |
| `BillingCycle(messId, year, month)` | two ledgers for one month |
| `MealEntry(memberId, date)` | double-counting a day |
| `MemberBill(cycleId, memberId)` | two bills for one member |
| `Payment.bkashPaymentId` | a replayed callback creating a second payment |

Money is `Decimal`, never `Float`. Nothing is hard-deleted — `isDeleted` +
`deletedAt`, and every read filters them out.

`Payment` cascades from its `MemberBill`, because reopening a cycle deletes the
bills so the settlement can be regenerated. A settled payment never reaches that
path: reopen is refused once any payment lands against the month.

---

## Caching

Three reads are cached in Redis — the ones that are expensive and identical for
every caller. Everything else is a single indexed query.

| Read | TTL | Dropped when |
| --- | --- | --- |
| `/admin/dashboard-stats` | 60 s | never — TTL only |
| `/grocery-duty/cycle-calendar/:cycleId` | 5 min | a duty is assigned, updated or removed |
| `/meal-plan/cycle-calendar/:cycleId` | 5 min | anyone declares a meal |

- Permission checks stay outside the cache. `checkMessAccess` runs per request;
  only the shared body is stored.
- The clock is never cached. The meal-plan calendar's `deadline` and `isLocked`
  are recomputed on every read, including cache hits. Redis holds only `date`,
  `lunch`, `dinner` and `members`.
- Redis is not on the critical path. Every cache call is wrapped, so if Redis is
  unavailable the loader runs and the caller still gets a correct answer.

Measured on dashboard stats: ~675 ms cold, ~330 ms warm.

---

## API Modules

All under `/api/v1`. Full reference: [docs/API.md](docs/API.md).

| Base path | What lives there |
| --- | --- |
| `/auth` | Register with email OTP, login, Google, refresh, forgot/reset password, `/me` |
| `/user` | Profile, avatar upload and removal |
| `/mess` | Create, list, update, soft-delete a mess |
| `/member` | Add and release members, memberships, mess roster |
| `/cycle` | Open a month, close it (runs the settlement), reopen it (Admin) |
| `/meal` | The register: what was actually eaten |
| `/meal-plan` | The calendar: what a member declares in advance, plus the cutoff |
| `/expense` | Groceries, utilities and rent, with an optional receipt photo |
| `/grocery-duty` | Booking a member for a date range, calendar, per-member totals |
| `/deposit` | Cash handed to the manager before there is a bill |
| `/payment` | Bills, bKash checkout, and the callback |
| `/admin` | Users, role changes, block/unblock, audit logs, dashboard stats |

### Admin guards

- A manager cannot be demoted while they still own a mess — they would keep the
  mess row but lose the routes that maintain it, leaving the month unclosable.
- A manager cannot be blocked while one of their messes has an OPEN cycle, since
  nobody else can record that month's meals or close it.
- An admin cannot change their own role or status.

`GET /admin/audit-logs` reads back what every module writes: cycle closed and
reopened, member removed, expense and deposit deleted, payment settled, role
changed, user blocked and unblocked — each row with the actor and the
before/after state, filterable by action, entity or actor.

---

## Payment (bKash Tokenized Checkout)

```
MEMBER -> POST /payment/create-payment { billId }
          amount is read from the BILL, never from the body
          Payment row created and COMMITTED, then bKash is called
          -> { paymentId, amount, paymentUrl }

          member pays on the bKash hosted page

bKash  -> GET /payment/callback?paymentID=...&status=...
          always calls /tokenized/checkout/execute and verifies before settling
          -> redirects the browser back to the frontend
```

**The callback is not trusted.** It is a public GET whose query string arrives
through the user's own address bar. Settlement requires all four of
`statusCode 0000`, `transactionStatus Completed`, `currency BDT`, and an amount
matching the row we created. A mismatch is refused and the whole gateway
response is stored in `Payment.gatewayResponse`.

**Settling is idempotent.** Refresh, back button and retries all re-fire the
callback, so the credit is claimed with a conditional update that only matches a
row still `UNPAID`. A second delivery changes nothing and still redirects to
success. Verified: three callbacks, one credit, one `PAYMENT_SETTLED` audit row.

**bKash is never called inside a transaction.** The row is committed first; if
the gateway call then fails the row stays `UNPAID`.

`src/app/lib/bkash.ts` is the only file that talks to bKash. It handles the grant
and refresh flow and caches both tokens in Redis (id token 1 h, refresh token
28 days). Sandbox versus live is `BKASH_BASE_URL`, not a code branch.

---

## Setup

```bash
# 1. Install
pnpm install

# 2. Configure
cp .env.example .env       # DATABASE_URL, REDIS_*, JWT secrets, GOOGLE_CLIENT_ID,
                           # SMTP_*, CLOUDINARY_*, BKASH_* (sandbox values included)

# 3. Apply the schema
npx prisma migrate deploy  # or: npx prisma migrate dev

# 4. Run — seeds the three demo accounts on boot
pnpm dev
```

Server starts at `http://localhost:5000`.

### Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | tsx watch, port 5000 |
| `pnpm build` | `prisma generate` + `tsup` — produces `dist/index.js` for deployment |
| `pnpm start` | run the server locally |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm check:settlement` | assert the settlement math balances |
| `pnpm lint:check` / `lint:fix` | Biome lint |
| `pnpm format:check` / `format:fix` | Biome format |

---

## Deployment (Vercel)

**Two entry points, one app.** `src/server.ts` is the local entry — it opens the
connections, seeds the demo accounts and calls `app.listen()`. `api/index.ts` is
the serverless entry and only exports the Express app from `src/app.ts`.
Middleware order and route mounting live in `src/app.ts`, so both entries behave
identically.

```
request      →  vercel.json  →  dist/index.js  →  src/app.ts
pnpm start   →  src/server.ts (app.listen)     →  src/app.ts
```

`pnpm build` bundles `api/index.ts` into a single `dist/index.js` with tsup. The
bundle is required, not an optimisation: this project is ESM with
`moduleResolution: "bundler"`, so both our code and Prisma's generated client
import each other without file extensions, which Node's ESM loader rejects with
`ERR_UNSUPPORTED_DIR_IMPORT`. Bundling resolves all of it at build time.

Because `vercel.json` uses a `builds` array, the platform never runs the project
build script — so build locally before deploying:

```bash
pnpm build && vercel --prod
```

Set every variable from `.env.example` in the Vercel dashboard. Three must differ
from their local values:

| Variable | Production value |
| --- | --- |
| `BACKEND_URL` | `https://messmatebackend.vercel.app` |
| `BKASH_CALLBACK_URL` | `https://messmatebackend.vercel.app/api/v1` |
| `FRONTEND_URL` | wherever the browser should land after paying |

If `BKASH_CALLBACK_URL` is left on localhost, bKash sends the browser to a
machine it cannot reach and the payment is taken but never settled. Do not set
`PORT` — the platform assigns it.

### What serverless required

- **No in-process state.** The rate limiter's counters were a `Map` in one
  process. They live in Redis now, otherwise "30 auth attempts per 15 minutes"
  becomes "30 per instance".
- **Connections open themselves.** Nothing runs `server.ts` on a serverless
  invocation, and the rate limiter's store sends its first command while
  `app.ts` is still being imported. `ensureRedis()` in `src/app/lib/redis.ts` is
  idempotent and safe to call concurrently.
- **Uploads fit the platform.** Multer's limit is 4 MB, under Vercel's 4.5 MB
  request-body cap. Files go from memory straight to Cloudinary, so nothing
  touches a filesystem.

Migrations are the one manual step: run `npx prisma migrate deploy` locally
against the production database after any schema change.

---

## API Response Shape

**Success**

```json
{ "success": true, "statusCode": 200, "message": "Expenses Retrieved Successfully", "data": [], "meta": { "page": 1, "limit": 10, "total": 57, "totalPages": 6 } }
```

**Error**

```json
{ "success": false, "statusCode": 400, "message": "Validation failed", "errors": [{ "field": "email", "message": "Invalid email" }] }
```

| Code | Meaning |
| --- | --- |
| 400 | Validation failure |
| 401 | Missing / invalid token |
| 403 | Wrong role, blocked user, or another mess's resource |
| 404 | Row does not exist |
| 409 | Business conflict — closed cycle, duplicate entry, missed cutoff |
| 429 | Rate limited |

---

## Postman

`postman/MessMate.postman_collection.json` — **91 requests across 15 folders**.
`baseUrl` already points at the live API, so importing and running it needs no
edits.

Run it top to bottom: tokens, `messId`, `cycleId`, `billId` and `paymentId` all
chain themselves through the requests' test scripts.

The order matters. Cleanup runs **Reopen → Remove member → Close → Delete mess**
because two rules pull in opposite directions: a member cannot be released while
they owe money, and a mess cannot be deleted while a cycle is still OPEN.

Eight requests are marked **Manual step** and cannot be automated — a file has to
be picked by hand (avatar, receipt), an OTP or refresh token pasted, or the bKash
hosted page actually paid. Everything else passes against the deployed API:

```
=== pass 83 | fail 0 | manual 8 | error 0 | total 91 ===
```

The Admin folder's two state-changing pairs are round trips — role there and
back, block then unblock — so later requests are not affected. The mess name
carries a per-run stamp, so the collection is re-runnable. `/auth` allows 30
requests per 15 minutes and a full run spends about eight, so three runs back to
back will start answering 429.

---

## Security

Passwords hashed with bcrypt · Bearer JWT with separate access and refresh
secrets · role and account status checked against the **database** row, not the
token payload · `helmet` · CORS allow-list · rate limiting (300/15 min general,
30/15 min on `/auth`, bKash callback exempt) · every secret read through
`src/app/config`.

---

## Status

- [x] Project setup, Prisma schema, migrations
- [x] Core middleware, error envelope, seeding
- [x] Auth (email/password + Google) and user module
- [x] Mess, member, cycle, meal, meal plan, expense, deposit, grocery duty
- [x] Settlement + cycle close transaction
- [x] bKash payment + idempotent callback
- [x] Admin operations — users, roles, block/unblock, audit logs, dashboard stats
- [x] Postman collection — 91 requests, verified end to end
- [x] Deployment
- [ ] Demo video

---

## Submission

```text
Project Name    : MessMate — Smart Mess & Shared Housing Management Platform
Backend Repo    : https://github.com/Maptaul/Messmate-Backend
Live API        : https://messmatebackend.vercel.app
API Docs        : https://github.com/Maptaul/Messmate-Backend/blob/main/docs/API.md
Demo Video      : (pending)
Admin Email     : admin@messmate.app
Admin Password  : (provided at submission)
```
