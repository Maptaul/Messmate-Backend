# MessMate 🏠 — Smart Mess & Shared Housing Management Platform (Backend)

A REST API that digitises the monthly accounts of a shared mess. Members record
daily meals, the manager records groceries and utility bills, and at month end
the system computes every member's real share and lets them settle it through
**bKash**.

Built for Programming Hero **B7A6** (Assignment 6) — backend only.

> **Why this project?** Our own 8-person mess in Chattogram keeps this ledger by
> hand every month: who ate how many meals, who did the grocery run, who paid the
> gas and electricity bill, and who owes what at the end. MessMate turns that
> notebook into an API.

---

## 🔑 Demo Credentials

| Role | Email | Password |
| --- | --- | --- |
| `ADMIN` | `admin@messmate.app` | see `.env` |
| `MESS_MANAGER` | `manager@messmate.app` | see `.env` |
| `MEMBER` | `member@messmate.app` | see `.env` |

Created automatically at server boot by `src/app/utils/seed.ts`.

---

## 🛠️ Tech Stack

| Tech | Purpose |
| --- | --- |
| Node.js + Express 5 | REST API |
| TypeScript (strict, ESM) | Type safety |
| PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) | Database + ORM |
| JWT + bcryptjs | Auth + password hashing |
| Google Identity (`google-auth-library`) | GCP social login |
| Zod | Request validation |
| Redis | bKash token cache |
| bKash Tokenized Checkout | Payment |
| Nodemailer + EJS | OTP and password-reset emails |
| Cloudinary + Multer | Avatars and expense receipts |
| Biome | Lint + format |

---

## 👥 The Three Roles

| Role | Can do |
| --- | --- |
| **ADMIN** | Platform operator. All messes and users, role changes, block/unblock, audit-log trail, dashboard stats, force-reopen a closed cycle. Never a resident of any mess. |
| **MESS_MANAGER** | Owns messes. Members, meals, expenses, deposits, grocery-duty bookings, and closing the month — for their own messes only. |
| **MEMBER** | Declares their own meal plan, pays their own bill, and reads the shared ledger — meals, expenses, deposits and duty for the whole mess, because it is the mess's money. Writes nothing but their own plan. |

`auth(...)` proves the caller has the right kind of account; `checkMessAccess`
proves the mess is theirs. A route that takes a `messId` needs both — without
the second, manager B could edit manager A's ledger with a valid token.

**The manager is a resident too.** They eat the meals, take their turn at the
grocery run, and settlement bills them like anyone else — managing is extra
responsibility, not a different kind of residency. So `checkMessAccess` returns
the manager's own `MessMember` row, not `null`; only `ADMIN` gets `null`, because
a platform operator oversees messes without living in one.

---

## 🧮 How the Settlement Works

The part that makes this more than CRUD.

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

`GROCERY` is excluded from `sharedCost` because it is already inside `mealRate`
— counting it twice would charge everyone for the groceries twice. `RENT` is
prorated by tenure rather than split flat, so someone who joined mid-month pays
for the days they were there.

A negative `dueAmount` is correct and kept: it means the mess owes the member,
because they paid for more groceries than they ate.

**Rounding invariant:** the sum of every member's `mealCost` must equal
`groceryTotal` exactly. Shares are rounded down and the remainder is allocated
deterministically, because a ledger that does not sum is a wrong ledger.

`pnpm check:settlement` asserts all of this — 20 checks over the pure function,
no database needed.

---

## 📅 Rules That Came From the Actual Mess

The three rules a real shared kitchen runs on, which no CRUD scaffold would guess.

**Meals are declared the night before.** A member sets their calendar in advance —
which days they will eat, and which of lunch and dinner. The plan for the 4th must
be in by **11 PM Dhaka time on the 3rd**; on the 4th itself it is too late. That
deadline is not decoration: whoever has the grocery duty shops against tomorrow's
headcount, and a plan that can change at noon is a plan they cannot shop against.
The server runs in UTC, so the cutoff is computed against an explicit Dhaka offset
rather than the machine clock.

**The plan and the register are open to the whole mess, not just the manager.**
Grocery duty rotates, so the person shopping on the 10th needs to see that only 5
of 8 are eating that day — otherwise they over-buy and everyone pays for it. Meal
reads are mess-wide for the same reason a shopping list is: it is the mess's money.

**Grocery duty is a booking, not a rotation.** The manager picks one member and a
date range of any length — four days for one person, six for the next, exactly
like choosing check-in and check-out dates. There is no "generate the month"
button; the calendar view is that same data read back day by day, and
`my-duty-days` totals what each person actually did.

---

## 🗄️ Database

11 models, one per schema file under `prisma/schema/`:

`User` · `Mess` · `MessMember` · `BillingCycle` · `MealEntry` · `Expense` ·
`Deposit` · `GroceryDuty` · `MemberBill` · `Payment` · `AuditLog`

Constraints carry business meaning — each one deletes a race condition rather
than defending against it:

| Constraint | Prevents |
| --- | --- |
| `BillingCycle(messId, year, month)` | two ledgers for one month |
| `MealEntry(memberId, date)` | double-counting a day |
| `MemberBill(cycleId, memberId)` | two bills for one member |
| `Payment.bkashPaymentId` | a replayed callback creating a second payment |

Money is `Decimal`, never `Float`. Nothing is hard-deleted — `isDeleted` +
`deletedAt`, and every read filters them out.

`Payment` cascades from its `MemberBill`, because reopening a cycle deletes the
bills so the settlement can be regenerated. An abandoned checkout against a bill
that no longer exists is noise; a settled one can never reach that path, since
reopen is refused the moment any payment lands against the month.

---

## 🧭 API Modules

All under `/api/v1`. The Postman collection is the full reference — this is the map.

| Base path | What lives there |
| --- | --- |
| `/auth` | Register with email OTP, login, Google, refresh, forgot/reset password, `/me` |
| `/user` | Profile, avatar upload and removal (Cloudinary) |
| `/mess` | Create, list, update, soft-delete a mess |
| `/member` | Add and release members, memberships, mess roster |
| `/cycle` | Open a month, close it (runs the settlement), reopen it (Admin) |
| `/meal` | The register: what was actually eaten, recorded by the manager |
| `/meal-plan` | The calendar: what a member declares in advance, plus the 11 PM cutoff |
| `/expense` | Groceries, utilities and rent, with an optional receipt photo |
| `/grocery-duty` | Booking a member for a date range, the day-by-day calendar, per-member totals |
| `/deposit` | Cash handed to the manager before there is a bill — becomes credit |
| `/payment` | Bills, bKash checkout, and the callback |
| `/admin` | Users, role changes, block/unblock, the audit-log trail, dashboard stats |

### Admin operations

Two guards are worth naming, because both come from the domain rather than from
a permissions table:

- **A manager cannot be demoted while they still own a mess.** They would keep the
  mess row but lose every route that maintains it — the month could no longer be
  closed and the ledger would sit there unfinishable.
- **A manager cannot be blocked while one of their messes has an OPEN cycle.**
  Nobody else can record that month's meals or close it, so blocking them mid-month
  strands the whole mess. An admin also cannot change their own role or status;
  self-demotion would remove the platform's last way back in.

`GET /admin/audit-logs` reads back what every other module writes — cycle closed
and reopened, member removed, expense and deposit deleted, payment settled, role
changed, user blocked and unblocked — each row carrying the actor and the
before/after state, filterable by action, entity or actor. A log that is written
but never readable is only half a feature.

---

## 💳 Payment (bKash Tokenized Checkout)

The graded core. A `status = "PAID"` flipped by hand scores zero, so every settled
payment traces back to a transaction bKash confirmed.

```
MEMBER -> POST /payment/create-payment { billId }
          amount is read from the BILL, never from the body
          Payment row created and COMMITTED, then bKash is called
          -> { paymentUrl }

          member pays on the bKash hosted page

bKash  -> GET /payment/callback?paymentID=...&status=...
          always calls /tokenized/checkout/execute and verifies before settling
          -> redirects the browser back to the frontend
```

**The callback is never believed.** It is a public GET whose query string arrives
through the user's own address bar — a notification that something *may* have
happened, not evidence. Settlement requires all four: `statusCode 0000`,
`transactionStatus Completed`, `currency BDT`, and an amount matching the row we
created. An amount that does not match is tampering; it is refused and the whole
gateway response is kept in `Payment.gatewayResponse` as the record.

**Settling is idempotent.** Refresh, back button and retries all re-fire the
callback, so the credit is claimed with a conditional update that only matches a
row still `UNPAID`. A second delivery claims nothing and changes nothing — and
still redirects to success, because a member who really paid must never be shown a
failure. Verified live: three callbacks, one credit, one `PAYMENT_SETTLED` audit row.

**bKash is never called inside a transaction.** A network round trip holding a
database connection open dies with the gateway. The row is committed first; if the
call then fails it simply stays `UNPAID`, which is the correct record of what happened.

`src/app/lib/bkash.ts` is the only file that talks to bKash — it owns the grant and
refresh dance and caches both tokens in Redis (id token 1 h, refresh token 28 days).
That cache is why Redis is a hard dependency. Sandbox versus live is
`BKASH_BASE_URL`, never a code branch.

---

## 🚀 Setup

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
| `pnpm build` | tsc → `dist/` |
| `pnpm start` | run the compiled build |
| `pnpm check:settlement` | assert the settlement math balances |
| `pnpm lint:check` / `lint:fix` | Biome lint |
| `pnpm format:check` / `format:fix` | Biome format |

---

## 📦 API Response Shape

Every endpoint returns the same envelope.

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
| 409 | Business conflict — closed cycle, duplicate meal entry, concurrent close |

---

## 📮 Postman

`postman/MessMate.postman_collection.json` — **91 requests across 15 folders**.
Import it, set `baseUrl`, and run the whole thing top to bottom: tokens, `messId`,
`cycleId`, `billId` and `paymentId` all chain themselves through the requests'
test scripts.

The order is load-bearing. Cleanup runs **Reopen → Remove member → Close → Delete
mess** because two rules pull in opposite directions: a member cannot be released
while they owe money, and a mess cannot be deleted while a cycle is still OPEN.
Reopening clears the bills, which satisfies the first; closing again satisfies the
second.

Eight requests are marked **Manual step** and cannot be automated — a file has to
be picked by hand (avatar, receipt), an OTP or refresh token pasted, or the bKash
hosted page actually paid. Everything else passes:

```
=== pass 83 | fail 0 | manual 8 | error 0 | total 91 ===
```

The Admin folder's two state-changing pairs are round trips — role there and
back, block then unblock — because leaving the demo member promoted or blocked
would break every request after it.

The mess name carries a per-run stamp, so the collection is re-runnable rather
than one-shot. Note that `/auth` allows 30 requests per 15 minutes and a full run
spends about eight, so three runs back to back will start answering 429 — that is
the limiter working.

---

## 🔒 Security

Passwords hashed with bcrypt · Bearer JWT with separate access and refresh
secrets · role checked against the **database** row, not the token payload ·
`helmet` · CORS allow-list · rate limiting (300/15min general, 30/15min on
`/auth`, bKash callback exempt so a real settlement is never dropped) · every
secret read through `src/app/config`.

---

## 📌 Status

Feature-complete — see `.agents/` for the conventions this repo follows.

- [x] Project setup, Prisma schema, migrations
- [x] Core middleware, error envelope, seeding
- [x] Auth (email/password + Google) and user module
- [x] Mess, member, cycle, meal, meal plan, expense, deposit, grocery duty
- [x] Settlement + cycle close transaction
- [x] bKash payment + idempotent callback
- [x] Admin operations — users, roles, block/unblock, audit-log read, dashboard stats
- [x] Postman collection — 91 requests, verified end to end against a live server
- [ ] Deployment and demo video

---

## 📄 Submission

```text
Project Name    : MessMate — Smart Mess & Shared Housing Management Platform
Backend Repo    : https://github.com/Maptaul/Messmate-Backend
Live API        : (pending)
API Docs        : (pending)
Demo Video      : (pending)
Admin Email     : admin@messmate.app
Admin Password  : (provided at submission)
```
