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
| Biome | Lint + format |

---

## 👥 The Three Roles

| Role | Can do |
| --- | --- |
| **ADMIN** | Platform operator. All messes and users, role changes, blocks, audit logs, statistics, force-reopen a closed cycle. |
| **MESS_MANAGER** | Owns messes. Members, meals, expenses, deposits, grocery-duty rotation, and closing the month — for their own messes only. |
| **MEMBER** | Own data only: own meals, own bill, own payments, own grocery duty. Pays their own bill. |

`auth(...)` proves the caller has the right kind of account; `checkMessAccess`
proves the mess is theirs. A route that takes a `messId` needs both — without
the second, manager B could edit manager A's ledger with a valid token.

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

---

## 🚀 Setup

```bash
# 1. Install
pnpm install

# 2. Configure
cp .env.example .env       # fill in DATABASE_URL, REDIS_*, JWT secrets, GOOGLE_CLIENT_ID

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

## 🔒 Security

Passwords hashed with bcrypt · Bearer JWT with separate access and refresh
secrets · role checked against the **database** row, not the token payload ·
`helmet` · CORS allow-list · rate limiting (300/15min general, 30/15min on
`/auth`, bKash callback exempt so a real settlement is never dropped) · every
secret read through `src/app/config`.

---

## 📌 Status

Backend in progress — see `.agents/` for the conventions this repo follows.

- [x] Project setup, Prisma schema, initial migration
- [x] Core middleware, error envelope, seeding
- [ ] Auth (email/password + Google) and user module
- [ ] Mess, cycle, meal, expense, deposit, grocery duty
- [ ] Settlement + cycle close transaction
- [ ] bKash payment + idempotent callback
- [ ] Postman collection, deployment, demo video

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
