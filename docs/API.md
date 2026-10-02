# MessMate API Reference

**Base URL:** `https://messmatebackend.vercel.app`
**Local:** `http://localhost:5000`

92 endpoints across 16 modules, all versioned under `/api/v1`. The runnable version of this reference is `postman/MessMate.postman_collection.json` — 141
requests that chain their own tokens and ids.

---

## Authentication

Bearer token in the `Authorization` header, or the `accessToken` cookie:

```http
Authorization: Bearer <accessToken>
```

`POST /api/v1/auth/login` returns the access token and sets a refresh cookie.
**Role and account status are re-read from the database on every request**. A demotion or a block takes effect on the next request, without waiting for the token to expire.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| `ADMIN` | `admin@messmate.app` | provided at submission |
| `MESS_MANAGER` | `manager@messmate.app` | provided at submission |
| `MEMBER` | `member@messmate.app` | provided at submission |

`pnpm seed:demo --write` fills the demo mess and two more with three closed
months, and adds `postman.manager@messmate.test` and
`postman.member@messmate.test`, the pair the Postman collection runs as. Every
`@messmate.test` account shares the demo member's password (managers: the demo
manager's), and no mail is ever sent to that domain.

---

## Response format

Every endpoint answers with the same envelope.

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

`meta` appears on list endpoints only.

**Error**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Not a valid email",
  "errors": [{ "field": "email", "message": "Not a valid email" }],
  "requestId": "a3f1c2e4-5b6d-7890-abcd-ef1234567890"
}
```

`requestId` is also returned on every response as the `x-request-id` header, and
it is the id written into the server log line for that request. If someone
reports a failure, that one value finds the log entry behind it.

| Code | Meaning |
| --- | --- |
| 400 | Validation failure |
| 401 | Missing or invalid token |
| 403 | Wrong role, blocked account, or another mess's resource |
| 404 | Row does not exist |
| 409 | Business conflict — closed cycle, duplicate entry, missed cutoff |
| 429 | Rate limited (300 per 15 min; 30 on `/auth`) |

---

## Query parameters

List endpoints accept `?page=` and `?limit=` (default 1 and 10, `limit` capped
at 100 — a bigger number is clamped rather than refused, and a zero, negative or
non-numeric one falls back to the default), `?sortBy=` and
`?sortOrder=asc|desc`. Where a search makes sense — messes, members, expenses,
meals, users — `?searchTerm=` matches the relevant text fields
case-insensitively. Domain filters are per endpoint: `?role=` and `?status=` on
users, `?type=` and `?paidByMemberId=` (`fund` = the mess fund) on expenses, `?memberId=` on meals and deposits, `?action=` and
`?entity=` on audit logs.

---

## Endpoints

### Auth — `/api/v1/auth`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/auth/register` | _public_ | yes | `role: MESS_MANAGER` needs `messName` + `messAddress` and files a manager request; the account starts as a member |
| POST | `/api/v1/auth/verify-email` | _public_ | yes |  |
| POST | `/api/v1/auth/login` | _public_ | yes |  |
| POST | `/api/v1/auth/google` | _public_ | yes |  |
| POST | `/api/v1/auth/refresh-token` | _public_ | — |  |
| POST | `/api/v1/auth/logout` | _public_ | — |  |
| POST | `/api/v1/auth/forgot-password` | _public_ | yes |  |
| POST | `/api/v1/auth/reset-password` | _public_ | yes |  |
| GET | `/api/v1/auth/me` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | includes `managerApplications` (the latest request) |

### User — `/api/v1/user`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| PATCH | `/api/v1/user/update-profile` | `ADMIN` `MESS_MANAGER` `MEMBER` | yes |  |
| PATCH | `/api/v1/user/profile-image` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | multipart/form-data |
| DELETE | `/api/v1/user/profile-image` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Mess — `/api/v1/mess`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/mess/create-mess` | `MESS_MANAGER` | yes | a manager runs one mess; 409 while they already manage one |
| GET | `/api/v1/mess/all-messes` | `ADMIN` | — |  |
| GET | `/api/v1/mess/my-messes` | `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/mess/update-mess/:messId` | `ADMIN` `MESS_MANAGER` | yes |  |
| DELETE | `/api/v1/mess/delete-mess/:messId` | `ADMIN` `MESS_MANAGER` | — |  |
| GET | `/api/v1/mess/audit-logs/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | the trail; a member sees only their own |
| GET | `/api/v1/mess/activity-unread/:messId` | `MESS_MANAGER` `MEMBER` | — | rows in your scope since you last looked, excluding your own |
| PATCH | `/api/v1/mess/activity-seen/:messId` | `MESS_MANAGER` `MEMBER` | — | resets the unread count to now |
| GET | `/api/v1/mess/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Member — `/api/v1/member`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/member/my-memberships` | `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/member/mess-members/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/member/remove-member/:memberId` | `ADMIN` `MESS_MANAGER` | — |  |
| PATCH | `/api/v1/member/leave/:messId` | `MEMBER` | — | leave a mess yourself; 409 while a bill is still owed |

### Membership — `/api/v1/membership`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/membership/join-code/:code` | `MEMBER` | — | the mess a join code belongs to (name, address, manager, member count) |
| POST | `/api/v1/membership/request` | `MEMBER` | yes | `{ joinCode, note? }` asks to join |
| POST | `/api/v1/membership/invite` | `ADMIN` `MESS_MANAGER` | yes | `{ messId, email }`; replaces `member/add-member` |
| GET | `/api/v1/membership/my` | `MEMBER` | — | your pending invitations and requests |
| GET | `/api/v1/membership/mess/:messId` | `ADMIN` `MESS_MANAGER` | — | `?status=PENDING\|ACCEPTED\|DECLINED\|CANCELLED` (default `PENDING`), `&kind=INVITE\|REQUEST` |
| POST | `/api/v1/membership/mess/:messId/join-code` | `ADMIN` `MESS_MANAGER` | — | a new join code; the old one stops working |
| PATCH | `/api/v1/membership/:id/accept` | any | — | an invite by the person invited; a request by the manager or an admin |
| PATCH | `/api/v1/membership/:id/decline` | any | — | same rule as accept |
| PATCH | `/api/v1/membership/:id/cancel` | any | — | whoever sent it, or an admin |

Nobody joins a mess without agreeing to it. A member asks with the join code
their manager shares, and the manager approves; or the manager invites by email,
and the member accepts. Until an invite is accepted the manager sees only the
address they typed. Accepting creates the membership (or brings a LEFT one back)
and is audited as `MEMBER_JOINED`; leaving is `MEMBER_LEFT`. One open invite or
request per person and mess, enforced by a partial unique index.

Known limits: an invite to an address with no account says so (404), which tells a
manager the address is not registered; and rejoining resets `joinedAt`.

### Billing Cycle — `/api/v1/cycle`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/cycle/open-cycle` | `ADMIN` `MESS_MANAGER` | yes |  |
| GET | `/api/v1/cycle/mess-cycles/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/cycle/settlement-preview/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | the bill if the month closed now; a member gets only their own line |
| GET | `/api/v1/cycle/trends/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | day-by-day meals, grocery and shared bills so far; see below |
| POST | `/api/v1/cycle/close-cycle/:cycleId` | `ADMIN` `MESS_MANAGER` | — | one bill per member who was there; last month's bills it opens with become `CARRIED` |
| POST | `/api/v1/cycle/reopen-cycle/:cycleId` | `ADMIN` | — | 409 once money landed, or while a later month is closed; `CARRIED` bills get their balance back |
| GET | `/api/v1/cycle/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Meal Register — `/api/v1/meal`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/meal/add-daily-meals` | `ADMIN` `MESS_MANAGER` | yes |  |
| GET | `/api/v1/meal/cycle-meals/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/meal/meal-summary/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/meal/update-meal/:mealId` | `ADMIN` `MESS_MANAGER` | yes |  |
| DELETE | `/api/v1/meal/delete-meal/:mealId` | `ADMIN` `MESS_MANAGER` | — |  |

### Meal Plan — `/api/v1/meal-plan`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/meal-plan/set-my-plan` | `ADMIN` `MESS_MANAGER` `MEMBER` | yes |  |
| PATCH | `/api/v1/meal-plan/set-default-meals` | `ADMIN` `MESS_MANAGER` `MEMBER` | yes | `{ messId, memberId?, lunch, dinner }` |
| GET | `/api/v1/meal-plan/my-calendar/:cycleId` | `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/meal-plan/cycle-calendar/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | `?date=` gives one day's headcount |
| POST | `/api/v1/meal-plan/apply-to-register` | `ADMIN` `MESS_MANAGER` | yes |  |

### Expense — `/api/v1/expense`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/expense/add-expense` | `ADMIN` `MESS_MANAGER` | yes | multipart/form-data |
| GET | `/api/v1/expense/cycle-expenses/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/expense/expense-summary/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/expense/update-expense/:expenseId` | `ADMIN` `MESS_MANAGER` | yes | multipart/form-data |
| DELETE | `/api/v1/expense/delete-expense/:expenseId` | `ADMIN` `MESS_MANAGER` | — |  |

### Grocery Duty — `/api/v1/grocery-duty`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/grocery-duty/assign-duty` | `ADMIN` `MESS_MANAGER` | yes |  |
| GET | `/api/v1/grocery-duty/cycle-duties/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/grocery-duty/cycle-calendar/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/grocery-duty/my-duty-days/:cycleId` | `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/grocery-duty/update-duty/:dutyId` | `ADMIN` `MESS_MANAGER` | yes |  |
| DELETE | `/api/v1/grocery-duty/remove-duty/:dutyId` | `ADMIN` `MESS_MANAGER` | — |  |

### Deposit — `/api/v1/deposit`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/deposit/add-deposit` | `ADMIN` `MESS_MANAGER` | yes |  |
| GET | `/api/v1/deposit/cycle-deposits/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/deposit/update-deposit/:depositId` | `ADMIN` `MESS_MANAGER` | yes |  |
| DELETE | `/api/v1/deposit/delete-deposit/:depositId` | `ADMIN` `MESS_MANAGER` | — |  |

### Payment — `/api/v1/payment`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/payment/callback` | _public_ | — |  |
| GET | `/api/v1/payment/result` | _public_ | — | HTML page the payer lands on |
| GET | `/api/v1/payment/my-bills` | `MESS_MANAGER` `MEMBER` | — |  |
| POST | `/api/v1/payment/create-payment` | `MESS_MANAGER` `MEMBER` | yes |  |
| POST | `/api/v1/payment/create-stripe-session` | `MESS_MANAGER` `MEMBER` | yes | card payment, returns `checkoutUrl` |
| POST | `/api/v1/payment/confirm-stripe` | `MESS_MANAGER` `MEMBER` | yes | `{ sessionId }` from the success redirect |
| GET | `/api/v1/payment/cycle-bills/:cycleId` | `ADMIN` `MESS_MANAGER` | — | every bill in one cycle |
| POST | `/api/v1/payment/record-cash-payment` | `ADMIN` `MESS_MANAGER` | yes | cash handed to the manager |
| GET | `/api/v1/payment/my-payments` | `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/payment/:paymentId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Personal finance — `/api/v1/finance`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/finance/categories` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | which categories belong to each type |
| POST | `/api/v1/finance/add-entry` | `ADMIN` `MESS_MANAGER` `MEMBER` | yes | `{ type, category, amount, date?, note? }` |
| GET | `/api/v1/finance/my-entries` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | `?type= &category= &from= &to= &searchTerm=` |
| GET | `/api/v1/finance/summary` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | `?period=daily\|weekly\|monthly\|yearly&date=` |
| PATCH | `/api/v1/finance/update-entry/:entryId` | `ADMIN` `MESS_MANAGER` `MEMBER` | yes | any field |
| DELETE | `/api/v1/finance/delete-entry/:entryId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | soft delete |

### Admin — `/api/v1/admin`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/admin/dashboard-stats` | `ADMIN` | — |  |
| GET | `/api/v1/admin/dashboard-trends` | `ADMIN` | — | seven weekly points for the overview's sparklines |
| GET | `/api/v1/admin/audit-logs` | `ADMIN` | — |  |
| GET | `/api/v1/admin/users` | `ADMIN` | — |  |
| GET | `/api/v1/admin/users/:userId` | `ADMIN` | — |  |
| PATCH | `/api/v1/admin/users/:userId/role` | `ADMIN` | yes |  |
| PATCH | `/api/v1/admin/users/:userId/status` | `ADMIN` | yes |  |

### Manager requests — `/api/v1/manager-request`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/manager-request/apply` | `MEMBER` | yes | `{ messName, messAddress }`; 409 while another request is pending |
| GET | `/api/v1/manager-request/all-requests` | `ADMIN` | — | `?status=PENDING\|APPROVED\|REJECTED&searchTerm=&page=&limit=` |
| POST | `/api/v1/manager-request/review` | `ADMIN` | yes | `{ requestId, status: APPROVED\|REJECTED, rejectionReason? }` — a reason is required to reject |

Nobody becomes a manager by signing up. Choosing to run a mess files a request;
an admin approves it (the account becomes `MESS_MANAGER`, the user logs in again)
or rejects it with a reason, and the applicant is emailed either way. Every
request is kept, a user can have only one pending at a time (a partial unique
index enforces it), and both decisions are written to the audit log as
`MANAGER_APPROVED` / `MANAGER_REJECTED`.


### The monthly advance

`POST /api/v1/mess/create-mess` and the update route accept `monthlyDeposit` —
the amount each member is charged every month for the **next** month's bazaar
fund. It defaults to `0`, which leaves a mess behaving as it did before.

When a cycle closes with `monthlyDeposit > 0`, every bill carries
`advanceCharged`, and `openingBalance` picks up whatever that member still owed
on the previous closed cycle of the same mess — negative when the mess owes
them. So `totalPayable` is now:

```
openingBalance + mealCost + sharedCost + rentShare + advanceCharged
```

`creditAmount` is unchanged: the deposits recorded against *this* cycle plus the
expenses this member paid out of pocket. A member who settles in full opens the
next month at zero.

**A carried balance is paid once.** The same close turns every previous bill it
opened with into `status: CARRIED`, `dueAmount: 0`, so the balance lives only on
the newest bill: paying the old one answers `409`, and the unpaid-bill reminder,
the leave check and the admin's outstanding total all skip it. Bill statuses are
`UNPAID`, `PARTIAL`, `PAID` and `CARRIED`.

Reopening the month that carried them restores each one —
`dueAmount = totalPayable − creditAmount − paidAmount`, `PARTIAL` if anything was
paid, else `UNPAID` — and `billsRestored` is recorded in the audit row. Reopening
an older month while a later one is closed answers
`409 Reopen The Newest Closed Month First`, because the later month already
opened with its balances.

**Only the people who were there share a month.** A member with no day in the
cycle (`joinedAt` after it, or `leftAt` before it) and no meal, deposit or
out-of-pocket expense in it gets no bill and no share of the shared expenses.

### The settlement preview

`GET /api/v1/cycle/settlement-preview/:cycleId` runs the same settlement
close-cycle runs — same members, meals, expenses, deposits, opening balances and
advance — on the ledger as it stands, and writes nothing. The response carries
`isPreview: true`, `asOf`, the running `totalMeals`, `totalGrocery` and
`mealRate`, and `bills` in exactly the shape close-cycle returns, each with the
member's `name`.

A member gets only their own line and no warnings; a manager or admin gets every
line plus the same warnings close-cycle would return. Rent and the advance are
charged in full, because that is what closing today would charge. On a closed
cycle it answers `409` — the bills are final by then; read them from
`/payment/my-bills` or `/payment/cycle-bills/:cycleId`.

### Trends for the overview sparklines

`GET /api/v1/cycle/trends/:cycleId` answers one value per day from the first
of the month to today (or to the month's last day): `meals` eaten, `grocery`
and `shared` bills (maid, gas, electricity, water, internet, other) spent that
day, and `myMeals` — the caller's own meals, `null` when they don't eat in
the mess. Values are per day, not running totals; a running meal rate is
running grocery over running meals. For a manager or admin, `previousDue` is
what the previous closed month still owed at the close of each Dhaka day, with
`previousCycle` naming it; a member gets `null` for both.

`GET /api/v1/admin/dashboard-trends` answers seven weekly points ending now:
how many `users` and `messes` existed, how many billing cycles were open
(`openCycles`) and the `outstandingDue` still owed on closed bills at each
point — every value read from the records' own dates, cached for a minute like
the stats.

### The personal finance tracker

Each user's own income and expenses, unrelated to any mess. Every query is
scoped to the caller, so another user's entry — for an admin too — answers
`404 Entry Not Found`, the same as one that never existed.

- `type` is `INCOME` or `EXPENSE`. `category` comes from a fixed list and must
  belong to the type: income takes `SALARY`, `TUITION`, `FAMILY`, `BUSINESS`,
  `OTHER`; expense takes `FOOD`, `MESS`, `TRANSPORT`, `EDUCATION`,
  `MOBILE_INTERNET`, `HEALTH`, `SHOPPING`, `ENTERTAINMENT`, `OTHER`. A mismatch,
  on add or on update, is `400`.
- `amount` is positive, at most two decimals and at most 10,000,000.
- `date` defaults to today in Dhaka; a future date is `400`.

`GET /api/v1/finance/summary` takes `period` (default `monthly`) and `date`
(default today) and answers for the period containing that date:

```json
{
  "period": "weekly",
  "from": "2026-09-12",
  "to": "2026-09-18",
  "income": 5000,
  "expense": 180.5,
  "balance": 4819.5,
  "byCategory": {
    "income": [{ "category": "TUITION", "total": 5000 }],
    "expense": [{ "category": "FOOD", "total": 120.5 }, { "category": "TRANSPORT", "total": 60 }]
  },
  "breakdown": [
    { "label": "2026-09-12", "from": "2026-09-12", "to": "2026-09-12", "income": 0, "expense": 0, "balance": 0 }
  ]
}
```

A week runs Saturday to Friday. `breakdown` is empty for a day, seven days for a
week, one entry per day for a month and twelve months (`label` `2026-09`) for a
year. Empty buckets are present with zeros, and `byCategory` is largest first.
Totals are summed in paisa. A bad `period` or `date` is `400`.

### Default meals and the headcount

`PATCH /api/v1/meal-plan/set-default-meals` takes `{ messId, memberId?, lunch,
dinner }` in half-meal steps. A member sets only their own; a manager may name
anyone in the mess.

On any day a member has no plan, their default counts. A plan always wins, and a
plan of 0/0 is how one day is switched off. `my-calendar` returns
`defaultMeals` and marks each day `isDefault`; `cycle-calendar` marks each member
row `isDefault`, and with `?date=` it is that day's headcount.
`apply-to-register` copies defaults in along with plans and reports how many it
took from defaults as `fromDefaults`.

Defaults cannot rewrite a locked day. When a day locks at 11 PM the headcount job
writes every silent member's default in as a real plan, and changing a default
after a day has locked first does the same for that member — so a member cannot
lower their default at midnight and escape a meal that was already cooked.

### Scheduled jobs — `/api/v1/cron`

Not for people. These are called by Vercel Cron, which sends
`Authorization: Bearer $CRON_SECRET`. Without that header they answer `401`, and
if `CRON_SECRET` is not configured at all they answer `503`. Add `?dryRun=true`
to any of them to see who *would* be emailed without sending anything.

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/cron/meal-plan-reminder` | _cron secret_ | — | daily 16:00 UTC (22:00 Dhaka) |
| GET | `/api/v1/cron/meal-headcount` | _cron secret_ | — | daily 17:05 UTC (23:05 Dhaka) |
| GET | `/api/v1/cron/unpaid-bill-reminder` | _cron secret_ | — | Mondays 04:00 UTC |

The meal-plan job runs an hour before the 11 PM Dhaka cutoff and emails every
active member of an open cycle who has neither a plan nor a default for
tomorrow. The headcount job runs just after the cutoff: it writes each silent
member's default in as tomorrow's plan, then emails each manager tomorrow's
lunch and dinner totals with a member-by-member table, defaults marked. A dry
run writes no plans. The
unpaid-bill job emails members whose bill on a closed cycle is still `UNPAID` or
`PARTIAL` with money owing. It runs weekly rather than daily, so an unpaid bill
is a nudge instead of a daily nag.

---

## The payment flow

```
MEMBER -> POST /api/v1/payment/create-payment { billId }
          amount is read from the bill, never from the body
          Payment row committed, then bKash is called
          -> { paymentId, amount, paymentUrl }

          member pays on the bKash hosted page

bKash  -> GET /api/v1/payment/callback?paymentID=...&status=...
          always calls tokenized/checkout/execute and verifies before settling
          -> 302 redirect back to the frontend
```

### Paying by card (Stripe, test mode)

```
MEMBER -> POST /api/v1/payment/create-stripe-session { billId }
          same bill checks as bKash; amount is the bill's dueAmount, in BDT
          Payment row committed with paymentGateway "stripe"
          -> { paymentId, amount, checkoutUrl }

          member pays on Stripe Checkout (test card 4242 4242 4242 4242)

Stripe -> browser to FRONTEND_URL/payment/success?session_id=...
          or FRONTEND_URL/payment/cancel?status=cancel

FRONTEND -> POST /api/v1/payment/confirm-stripe { sessionId }
          retrieves the session from Stripe and settles only when it is paid,
          in BDT, for exactly the Payment row's amount -> { paid, paymentId }
```

Settling reuses the bKash path's conditional update, so confirming the same
session twice credits the bill once. Needs `STRIPE_SECRET_KEY` and
`FRONTEND_URL`; without the key the two endpoints answer `503`.

### Paying in cash

Most mess money is still notes in a hand. `POST /api/v1/payment/record-cash-payment`
takes `{ billId, amount, note? }` and is manager-only — a member cannot mark
their own bill paid.

The manager finds that `billId` through
`GET /api/v1/payment/cycle-bills/:cycleId`, which lists every bill in one cycle
with the member's name and what they still owe, ordered by the largest due
first. `/my-bills` only ever returns the caller's own bills, so without this a
manager had no way to reach anyone else's. It takes the usual `?page=`,
`?limit=`, plus `?status=UNPAID|PARTIAL|PAID` and `?searchTerm=` on the member's
name or email. A member calling it gets a `403` — it is the whole mess's money,
not theirs.

It does exactly what the bKash path does after verification: adds to
`paidAmount`, recomputes `dueAmount`, moves the bill to `PARTIAL` or `PAID`, and
writes a `PAYMENT_SETTLED` audit row with the manager as the actor. The `Payment`
row it creates carries `paymentGateway: "cash"`, so cash and bKash sit in the
same ledger and the same `my-payments` list.

Overpaying is refused with a `400` naming what is actually left, and the bill
update is conditional on the `paidAmount` it read, so two managers recording the
same cash at once cannot double-credit it — the second gets a `409`.

The member gets the same receipt email and PDF, with the method shown as cash
rather than a bKash transaction id.

### The bKash callback

The callback is a public GET whose query string arrives through the user browser, so its contents are not trusted. Settlement requires all four of
`statusCode 0000`, `transactionStatus Completed`, `currency BDT` and an amount
matching the row we created. It runs behind a conditional update, so a refreshed callback credits the bill once.

---

## Notes for evaluators

- **Soft deletes.** Nothing is removed from the database. `DELETE` endpoints set
  `isDeleted` and `deletedAt`, and every read filters them out.
- **Audit log.** Cycle closed and reopened, member removed, expense and deposit
  added, changed or deleted, payment settled, role changed, user blocked and unblocked, and every
  meal recorded, changed or deleted — each with the actor and the before/after
  state. Meals are on that list because a meal is money: the manager may write
  anyone's row, with no cutoff, but never anonymously.

  Two ways in. `GET /api/v1/admin/audit-logs` is the platform view, `ADMIN` only,
  every mess. `GET /api/v1/mess/audit-logs/:messId` is the mess view, and the
  role decides how much of it you get:

  | Caller | Sees |
  | --- | --- |
  | `ADMIN` | the whole mess; `?memberId=` narrows it |
  | `MESS_MANAGER` | their own mess; `403` on anyone else's; `?memberId=` narrows it |
  | `MEMBER` | only rows about themselves, in a mess they belong to |

  A member's scope comes from their own `MessMember` row, resolved server-side by
  `checkMessAccess` — passing `?memberId=` someone else changes nothing.

  Every mess-scoped row carries `messId`, and rows about one person also carry
  `subjectMemberId`: meals recorded, changed and deleted, a deposit added,
  changed or deleted, an expense added or changed by the member who paid for it,
  a payment settled, a member removed. Closing or reopening a cycle touches
  everybody, so it carries no subject and a member does not see it. Platform
  actions — role changes, blocks — carry no `messId` at all and stay on the admin
  view alone. All of them take `?action=`, `?entity=` and `?actorId=`.

  `GET /api/v1/mess/activity-unread/:messId` counts rows in that same scope
  created after the caller's `feedSeenAt`, leaving out rows the caller wrote
  themselves; `PATCH /api/v1/mess/activity-seen/:messId` sets `feedSeenAt` to
  now. Both need a membership in the mess, so an admin gets a `403`.
- **Two-layer authorization.** `auth(...)` proves the account type;
  `checkMessAccess` proves the mess is the caller's. Both are required on any
  route that takes a `messId` or a `cycleId`.
