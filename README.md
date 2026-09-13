# MessMate — Smart Mess & Shared Housing Management Platform (Backend)

A REST API for the monthly accounts of a shared mess. Members record daily
meals, the manager records groceries and utility bills, and at month end the
system computes every member's share and lets them settle it through **bKash**.

**Live API:** <https://messmatebackend.vercel.app> · **[API Reference](docs/API.md)** · **[Postman collection](postman/MessMate.postman_collection.json)**

Our own 8-person mess in Chattogram keeps this ledger by hand every month: who
ate how many meals, who did the grocery run, who paid the gas and electricity
bill, and who owes what at the end. MessMate turns that notebook into an API.

---

## Tech Stack

| Tech                                         | Purpose                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| Node.js + Express 5                          | REST API                                                      |
| TypeScript (strict, ESM)                     | Type safety                                                   |
| PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) | Database + ORM                                                |
| JWT + bcryptjs                               | Auth + password hashing                                       |
| Google Identity (`google-auth-library`)      | GCP social login                                              |
| Zod                                          | Request validation                                            |
| Redis                                        | bKash token cache, OTP state, read cache, rate-limit counters |
| bKash Tokenized Checkout                     | Payment                                                       |
| Nodemailer + EJS                             | OTP, bill, receipt and reminder emails                        |
| pdfkit                                       | Bill and receipt PDFs attached to those emails                |
| node-cron + Vercel Cron                      | Scheduled reminders, one set of jobs either way               |
| Cloudinary + Multer                          | Avatars and expense receipts                                  |
| tsup                                         | Bundles the serverless entry                                  |
| Biome                                        | Lint + format                                                 |

---

## The Three Roles

| Role             | Can do                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADMIN**        | Platform operator. All messes and users, role changes, block/unblock, audit logs, dashboard stats, force-reopen a closed cycle. Not a resident of any mess. |
| **MESS_MANAGER** | Owns messes. Members, meals, expenses, deposits, grocery-duty bookings, and closing the month — for their own messes only.                                  |
| **MEMBER**       | Declares their own meal plan and pays their own bill. Reads the shared ledger: meals, expenses, deposits and duty for the whole mess.                       |

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
  opening     = what they still owed when last month closed   (0 for a new mess)
  mealCost    = meals × mealRate
  sharedCost  = gas + electricity + water + internet + maid, split EQUAL or BY_MEAL
  rentShare   = monthlyRent × daysPresent / daysInMonth      (prorated)
  advance     = monthlyDeposit, charged for next month's fund
  credit      = deposits + expenses this member personally paid
  due         = opening + mealCost + sharedCost + rentShare + advance − credit
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

### Every taka that buys food must be an expense

`mealRate` divides `groceryTotal` — the sum of `GROCERY` expenses — by the meals.
So any money that bought food has to be recorded as an expense, including money
that came out of the mess fund rather than someone's pocket. Record those with no
`paidByMemberId`: the field is optional, and leaving it out means the mess paid,
not a person.

Our own August 2026 ledger shows why this matters. Members fronted ৳8,985 of
bazaar from their own pockets, and a further ৳4,800 came from the eight ৳600
monthly deposits. Over 282.5 meals:

| Recorded                                       | `groceryTotal` | `mealRate` |
| ---------------------------------------------- | -------------- | ---------- |
| personal bazaar only                           | ৳8,985         | ৳31.81     |
| personal bazaar **+ the ৳4,800 from the fund** | ৳13,785        | **৳48.80** |

The paper ledger's own figure is ৳48.79646, so the second row is the correct one.
Miss the fund purchase and nothing errors — the rate simply comes out about a
third too low, and every bill is quietly wrong.

A deposit is credit against a member's own bill. It is not, by itself, grocery
money; the shopping it paid for is.

Because nothing errors, closing a cycle checks for it. If a cycle took deposits
and no grocery expense was recorded against the fund, the close response carries
a `warnings` entry saying so. It does not block the close — a mess whose fund
genuinely bought nothing is entitled to close — it just refuses to let the
mistake pass in silence.

### The rolling advance

Our mess takes ৳600 from everyone at the start of each month, and that money is
what buys the next month's bazaar. So the deposit is not only a credit — it is
also a **charge**, and the two land in different months:

- the ৳600 you handed over **this** month credits **this** month's bill
- the ৳600 on the bill is the advance for **next** month

Whatever is left unpaid when the month closes is carried into the next month's
bill as `openingBalance`, positive if you owe and negative if the mess owes you.
It rolls until it is settled.

`Mess.monthlyDeposit` is what a mess charges. Leave it at `0` and MessMate
behaves exactly as it did before — no advance line, and nothing carried forward.

### Half meals

Real ledgers record them — ours has a member on `17½` for August — so `lunch` and
`dinner` accept multiples of `0.5`. A mess has half meals, not thirds, which is
exactly what the validation says.

The whole of that August is a test. `tests/august-2026-ledger.test.ts` feeds the
paper month to `computeSettlement` and asserts the rate lands on ৳48.7965 against
the ledger's own ৳48.79646, that the meal costs sum back to ৳13,785 to the paisa,
that the month settles to zero, and that the 17.5 survives into that member's
bill.

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

12 models, one per schema file under `prisma/schema/`:

`User` · `Mess` · `MessMember` · `BillingCycle` · `MealEntry` · `MealPlan` ·
`Expense` · `Deposit` · `GroceryDuty` · `MemberBill` · `Payment` · `AuditLog`

Entity relationships and the reasoning behind them: **[docs/ERD.md](docs/ERD.md)**.

| Constraint                          | Prevents                                      |
| ----------------------------------- | --------------------------------------------- |
| `BillingCycle(messId, year, month)` | two ledgers for one month                     |
| `MealEntry(memberId, date)`         | double-counting a day                         |
| `MemberBill(cycleId, memberId)`     | two bills for one member                      |
| `Payment.bkashPaymentId`            | a replayed callback creating a second payment |

Money is `Decimal`, never `Float`. Nothing is hard-deleted — `isDeleted` +
`deletedAt`, and every read filters them out.

`Payment` cascades from its `MemberBill`, because reopening a cycle deletes the
bills so the settlement can be regenerated. A settled payment never reaches that
path: reopen is refused once any payment lands against the month.

---

## Caching

Three reads are cached in Redis — the ones that are expensive and identical for
every caller. Everything else is a single indexed query.

| Read                                    | TTL   | Dropped when                           |
| --------------------------------------- | ----- | -------------------------------------- |
| `/admin/dashboard-stats`                | 60 s  | never — TTL only                       |
| `/grocery-duty/cycle-calendar/:cycleId` | 5 min | a duty is assigned, updated or removed |
| `/meal-plan/cycle-calendar/:cycleId`    | 5 min | anyone declares a meal                 |

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

| Base path       | What lives there                                                              |
| --------------- | ----------------------------------------------------------------------------- |
| `/auth`         | Register with email OTP, login, Google, refresh, forgot/reset password, `/me` |
| `/user`         | Profile, avatar upload and removal                                            |
| `/mess`         | Create, list, update, soft-delete a mess                                      |
| `/member`       | Add and release members, memberships, mess roster                             |
| `/cycle`        | Open a month, close it (runs the settlement), reopen it (Admin)               |
| `/meal`         | The register: what was actually eaten                                         |
| `/meal-plan`    | The calendar: what a member declares in advance, plus the cutoff              |
| `/expense`      | Groceries, utilities and rent, with an optional receipt photo                 |
| `/grocery-duty` | Booking a member for a date range, calendar, per-member totals                |
| `/deposit`      | Cash handed to the manager before there is a bill                             |
| `/payment`      | Bills, bKash checkout, and the callback                                       |
| `/admin`        | Users, role changes, block/unblock, audit logs, dashboard stats               |
| `/cron`         | Vercel Cron endpoints for the two email reminders, behind a shared secret     |

### Admin guards

- A manager cannot be demoted while they still own a mess — they would keep the
  mess row but lose the routes that maintain it, leaving the month unclosable.
- A manager cannot be blocked while one of their messes has an OPEN cycle, since
  nobody else can record that month's meals or close it.
- An admin cannot change their own role or status.

`GET /admin/audit-logs` reads back what every module writes: cycle closed and
reopened, member removed, expense and deposit deleted, payment settled, role
changed, user blocked and unblocked, and every meal recorded, changed or deleted
— each row with the actor and the before/after state, filterable by action,
entity or actor.

**Why meals are on that list.** The manager fills the register for the whole
mess, with no cutoff, because what was eaten is the truth and it is written down
after the fact. But a meal is money — it is `mealRate` on that member's bill, and
it shifts everyone else's share too. So the register is the manager's to fill,
and it is not anonymous.

**Who can read it.** `GET /admin/audit-logs` is the platform view and stays
`ADMIN`-only. `GET /mess/audit-logs/:messId` is the mess view, and the role
decides the scope: a manager gets their whole mess and a `403` on anybody else's,
a **member gets only the rows about themselves**.

That last part is the point. The meal audit exists to protect members from silent
changes, so the member has to be able to see it. Their scope is resolved from
their own `MessMember` row on the server — asking for `?memberId=` someone else
changes nothing.

Rows about one person carry a `subjectMemberId`; closing a cycle touches everyone
and carries none, so it stays out of a member's view. Platform actions like a
role change carry no `messId` at all and never reach a mess view.

---

## Payment (bKash Tokenized Checkout)

```
**Cash still works.** Most mess money is notes in a hand, so
`POST /payment/record-cash-payment` lets the manager record what a member handed
over: same arithmetic, same audit row, same receipt, `paymentGateway: "cash"`.
Overpaying is refused, and the bill update is conditional on what it read, so two
managers recording the same cash cannot double-credit it.

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

After checkout, bKash sends the payer back to the API's own result page at
`GET /payment/result` — a small responsive page, since a payer is holding a
phone and there is no frontend yet. Point `PAYMENT_RESULT_URL` at a frontend
route when one exists and the callback will redirect there instead. Settlement
happens server-side either way; the page only reports what already happened.

---

## The Monthly Bill

Closing a cycle emails every member their share and attaches it as a PDF. The
lines follow the mess's own paper sheet — meals, meal cost, **khala**, each
utility, rent — rather than one lumped "shared bills" figure, and the deposit is
shown separately from the bazaar a member fronted themselves.

Our own August 2026, Tarak's line:

```
August 2026 — Tarak

Last month's balance       BDT     0.00
Your meals                        33
Meal cost (33 × 48.80)     BDT 1,610.28
Khala                      BDT   438.00
Electricity                BDT   400.00
Rent share                 BDT 1,600.00
Next month's deposit       BDT   600.00
Total payable              BDT 4,648.28

Deposit                    BDT   600.00
Bazaar you paid yourself   BDT   630.00
Total credit               BDT 1,230.00

You owe                    BDT 3,418.28
```

The paper sheet says ৳3,425 for the same line. The ৳6.72 gap is the whole
difference: the mess rounds the meal rate to ৳49 by hand, MessMate keeps
৳48.7965. Nothing else differs.

The itemisation comes from `sharedBreakdown` on the settlement result, so it is
computed, not typed. A mess that records nothing but groceries still gets the
single shared line.

A settled payment — bKash or cash — sends the same document as a receipt.

---

## Scheduled Jobs

Two triggers, one set of jobs, because the app runs in two shapes.

On Vercel, `node-cron` cannot work — a serverless instance sleeps between
requests and its timers die with it. Two entries in `vercel.json` call
authenticated endpoints instead:

| Job                          | Runs              | Emails                                                 |
| ---------------------------- | ----------------- | ------------------------------------------------------ |
| `/cron/meal-plan-reminder`   | 16:00 UTC daily   | members of an open cycle with no plan set for tomorrow |
| `/cron/unpaid-bill-reminder` | 04:00 UTC Mondays | members still owing money on a closed cycle            |

16:00 UTC is 22:00 in Dhaka — one hour before the meal-plan cutoff, which is the
only time a reminder is worth sending. The bill reminder is weekly rather than
daily on purpose: a daily email about the same unpaid bill is a nag.

Both require `Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends
automatically, and answer `503` if `CRON_SECRET` is unset — so they are never
open to the internet. Both accept `?dryRun=true`, which reports exactly who would
be emailed and sends nothing.

Run it as a long-lived process instead — `pnpm start` on a VPS, or locally for
the real mess — and `node-cron` schedules the same two jobs in `Asia/Dhaka`
directly. That scheduler starts from `src/server.ts` only, which the serverless
entry never imports, so the two triggers can never both fire.

---

## Setup

```bash
# 1. Install
pnpm install

# 2. Configure
cp .env.example .env       # DATABASE_URL, REDIS_*, JWT secrets, GOOGLE_CLIENT_ID,
                           # SMTP_*, CLOUDINARY_*, BKASH_* (sandbox values included)
                           # CRON_SECRET guards the scheduled jobs; leave it
                           # empty and they answer 503 instead of running

# 3. Apply the schema
npx prisma migrate deploy  # or: npx prisma migrate dev

# 4. Run — seeds the three demo accounts on boot
pnpm dev
```

Server starts at `http://localhost:5000`.

### Scripts

| Command                            | Does                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                         | tsx watch, port 5000                                                 |
| `pnpm build`                       | `prisma generate` + `tsup` — produces `dist/index.js` for deployment |
| `pnpm start`                       | run the server locally                                               |
| `pnpm typecheck`                   | `tsc --noEmit`                                                       |
| `pnpm test`                        | 91 checks on Node's own test runner                                  |
| `pnpm check:settlement`            | assert the settlement math balances                                  |
| `pnpm check:all`                   | typecheck + lint + settlement + tests, the same set CI runs          |
| `pnpm test:postman`                | drive the Postman collection through newman (`:local` for localhost) |
| `pnpm lint:check` / `lint:fix`     | Biome lint                                                           |
| `pnpm format:check` / `format:fix` | Biome format                                                         |

### Tests

No framework — `node --test` with `node:assert`. `tests/api.test.ts` boots the
real Express app on an ephemeral port and drives it over HTTP, so the middleware
chain, the error envelope and the auth guards are exercised as deployed. The rest
are unit tests over the pure pieces: the settlement engine against a real month
of paper accounts, the Dhaka/UTC cutoff arithmetic, validation, pagination.

CI runs the lot on every push and pull request.

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

| Variable             | Production value                              |
| -------------------- | --------------------------------------------- |
| `BACKEND_URL`        | `https://messmatebackend.vercel.app`          |
| `BKASH_CALLBACK_URL` | `https://messmatebackend.vercel.app/api/v1`   |
| `FRONTEND_URL`       | wherever the browser should land after paying |

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
{
  "success": true,
  "statusCode": 200,
  "message": "Expenses Retrieved Successfully",
  "data": [],
  "meta": { "page": 1, "limit": 10, "total": 57, "totalPages": 6 }
}
```

**Error**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Invalid email" }]
}
```

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| 400  | Validation failure                                               |
| 401  | Missing / invalid token                                          |
| 403  | Wrong role, blocked user, or another mess's resource             |
| 404  | Row does not exist                                               |
| 409  | Business conflict — closed cycle, duplicate entry, missed cutoff |
| 429  | Rate limited                                                     |

---

## Postman

`postman/MessMate.postman_collection.json` — **103 requests across 18 folders**.
`baseUrl` already points at the live API, so importing and running it needs no
edits.

Run it top to bottom: tokens, `messId`, `cycleId`, `billId` and `paymentId` all
chain themselves through the requests' test scripts.

The order matters. Cleanup runs **Reopen → Remove member → Close → Delete mess**
because two rules pull in opposite directions: a member cannot be released while
they owe money, and a mess cannot be deleted while a cycle is still OPEN.

**Cash payments** runs between that re-close and **Teardown**'s final delete, and it has to. Recording a payment makes a month final — reopen is refused once money has landed against it — so any settled payment earlier in the run would stop Cleanup from reopening at all.

Eight requests are marked **Manual step** and cannot be automated — a file has to
be picked by hand (avatar, receipt), an OTP or refresh token pasted, or the bKash
hosted page actually paid. Everything else passes against the deployed API:

```
=== pass 83 | fail 0 | manual 8 | error 0 | total 91 ===
```

That run covered the 91 requests as submitted. Twelve more were added since,
and each was run against a local server: the payment result page, the three
**Scheduled jobs** requests, cycle bills and cash payments with their rejection
paths, and the mess audit trail read by a manager and by a member. The member
requests assert that every row returned is about that member, and that passing
someone else's `?memberId=` does not widen it. The cron requests all use `?dryRun=true`, so they report
who would be emailed and send nothing; they need `cronSecret` set to the same
value as the server's `CRON_SECRET`.

`pnpm test:postman` runs the collection from the command line through newman,
and `pnpm test:postman:local` points it at `localhost:5000`.

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
30/15 min on `/auth`, bKash callback exempt) · scheduled-job endpoints behind a
shared secret compared in constant time · list `limit` clamped to 100 · every
secret read through `src/app/config`.

Every response carries an `x-request-id`, repeated in the body of any error and
written into the log line for that request — so a user reporting a failure can
quote one value that finds it.

---

## Status

- [x] Project setup, Prisma schema, migrations
- [x] Core middleware, error envelope, seeding
- [x] Auth (email/password + Google) and user module
- [x] Mess, member, cycle, meal, meal plan, expense, deposit, grocery duty
- [x] Settlement + cycle close transaction
- [x] bKash payment + idempotent callback
- [x] Admin operations — users, roles, block/unblock, audit logs, dashboard stats
- [x] Postman collection — 103 requests, verified end to end
- [x] Deployment
- [x] Demo video
- [x] Half meals, deposit-funded groceries, the August 2026 ledger as a test
- [x] Test suite + CI, request ids, scheduled reminders
- [x] Bill and receipt emails with PDF invoices, itemised like the paper sheet
- [x] Cash payments recorded by the manager, alongside bKash
- [x] Rolling monthly advance and a balance that carries between months

Known limitations and what comes next: **[docs/ROADMAP.md](docs/ROADMAP.md)**.

---

## Submission

```text
Project Name    : MessMate — Smart Mess & Shared Housing Management Platform
Backend Repo    : https://github.com/Maptaul/Messmate-Backend
Live API        : https://messmatebackend.vercel.app
API Docs        : https://github.com/Maptaul/Messmate-Backend/blob/main/docs/API.md
Demo Video      : https://www.loom.com/share/be92f0b77582452e86a86ddcceb4bcdd
Admin Email     : admin@messmate.app
```
