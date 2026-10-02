# MessMate — Roadmap

What stood between the submitted assignment and something a real mess can run
on. Most of it is now built; what is left is listed at the bottom, with the
reason it is still open.

Three of these came out of checking the system against our mess's actual
August 2026 paper accounts, and are marked **from the ledger** — no amount of
code review would have surfaced them.

---

## Done

### 1. Production leaked stack traces

`NODE_ENV` was set to `development` on Vercel, so every error response carried a
stack trace with `/var/task/dist/index.js` paths. The guard already existed in
`globalErrorHandler.ts`; only the environment variable was wrong. Corrected on
2026-09-07, and error bodies are now just
`{ success, statusCode, message, errors, requestId }`.

### 2. Deposit-funded groceries must be recorded — **from the ledger**

August 2026, real numbers: members fronted ৳8,985 of bazaar personally, and
another ৳4,800 came from the eight ৳600 monthly deposits. Over 282.5 meals the
mess's own spreadsheet gives a rate of **৳48.79646**.

Feeding `computeSettlement` a `groceryTotal` of ৳13,785 reproduces ৳48.7965.
Feeding it only the ৳8,985 gives ৳31.81 — about a third too low. So the formula
was never wrong; the *usage* was the trap. The fund's shopping has to be entered
as a `GROCERY` expense with no `paidByMemberId`.

That was always supported but never prompted. Now `closeCycle` runs
`depositFundedGroceryWarning` and returns a `warnings` array beside the bills:
if a cycle took deposits and no grocery expense was recorded against the fund,
closing it says so in the response instead of silently billing everyone a third
short. Nothing is blocked — a mess whose fund genuinely bought nothing can
ignore it.

### 3. Half meals — **from the ledger**

The August register records `½ + 1` for one member on the 16th, and `17½` as his
monthly total. `MealEntry.lunch` / `.dinner` were `Int` and validated with
`.int(...)`, so the API rejected it with a 400.

Four columns moved to `Float` (`DOUBLE PRECISION`): `meal_entries.lunch`,
`meal_entries.dinner`, and the same pair on `meal_plans` — plus
`member_bills.mealCount` and `billing_cycles.totalMeals`, which the original
plan missed and which would have broken cycle close on the first half meal.
Validation is now `.multipleOf(0.5)`: a mess has half meals, not thirds.

`Float` rather than the `Decimal(4,1)` first sketched, for one practical reason:
Prisma hands `Decimal` back as an object that serialises to a JSON *string*, so
every meal count in every API response would have changed shape and eight
`_sum.lunch + _sum.dinner` reads would have needed wrapping. Multiples of 0.5 are
exactly representable in binary floating point, so nothing is lost. Typecheck
passed with zero call-site changes.

### 4. Replay the real August 2026 month — **from the ledger**

`tests/august-2026-ledger.test.ts` runs the whole paper month through
`computeSettlement`:

| | meals | bazaar | deposit | paid in |
| --- | --: | --: | --: | --: |
| Samir | 59 | 1200 | 600 | 1800 |
| Ahir | 40 | 1000 | 600 | 1600 |
| Arman | 17.5 | 1015 | 600 | 1615 |
| Parvez | 28 | 1170 | 600 | 1770 |
| Rafi | 48 | 1850 | 600 | 2450 |
| Shuvo | 18 | 872 | 600 | 1472 |
| Tarak | 33 | 630 | 600 | 1230 |
| Jihan | 39 | 1248 | 600 | 1848 |
| | **282.5** | **8985** | **4800** | **13785** |

It asserts the rate comes out at ৳48.7965 against the ledger's ৳48.79646, that
the meal costs sum back to ৳13,785 to the paisa, that the month settles to zero,
and that Arman's 17.5 survives into his bill. One test pins the failure mode too:
leave the fund's ৳4,800 out and the rate drops to ৳31.81.

The paper month is now a permanent regression test.

### 5. Automated tests

`pnpm test` runs 149 checks on Node's own test runner — no framework:

- `august-2026-ledger` — the real month, above
- `bill-breakdown` — the same month with khala, utilities and rent, against the
  paper bill sheet
- `api` — boots the Express app on an ephemeral port and drives the real
  middleware chain over HTTP
- `cron-dates` — Dhaka/UTC boundaries around the 11 PM cutoff
- `email-templates` — renders every email, so a broken template fails the build
  rather than a member's inbox
- `rolling-advance` — a balance carried across three months, a carried bill
  given its balance back on reopen, and nobody absent billed for a month
- `manager-request` and `membership` — who may answer an invitation or a
  request, join-code parsing, and every email they send
- `payment-gateways` — the rate limiter keys a signed-in request on its user
  and a credential attempt on the account
- `default-meals` — a plan beats a default, and nobody eats before joining or
  after leaving
- `activity-feed` — a member's feed scope cannot be widened from the query string
- `finance-summary` — Saturday-to-Friday weeks across month and year ends, leap
  Februaries, paisa-exact totals and gap-free breakdowns
- `finance-rules` — a category only fits its own type; amounts are positive,
  whole paisa and bounded
- `bkash-execute` — an unreadable bKash execute answer falls back to the status
  API instead of crashing the callback
- `concurrency`, `cycle-warnings`, `meal-validation`, `payment-result`

`pnpm check:settlement` still runs its 20 assertions on the pure function, and
`pnpm check:all` runs typecheck, lint, both suites.

The integration suite paid for itself immediately: it found that a malformed
JSON body returned **500**, because `body-parser`'s `SyntaxError` was not on the
list of known errors. Now it answers 400.

`pnpm test:postman` and `pnpm test:postman:local` drive the 141-request
collection through newman.

### 6. CI

`.github/workflows/ci.yml` runs typecheck, lint, the settlement check and the
test suite on every push to `main` and every pull request.

### 7. Unbounded page size

Every list service read `query.limit ? Number(query.limit) : 10` with no
ceiling, so `?limit=1000000` was accepted. All fourteen list queries now clamp
inline, which also floors a fractional limit and refuses to produce a negative
skip from a negative page.

This was briefly a shared `parsePagination` helper. That broke
`rules/03-database.md` — "the reference does this inline in every list service,
with no shared query builder. Follow it" — so it went back inline, with the fix
kept rather than the bug.

### 8. Implicit Redis coupling

`bkash.ts`, `cache.ts` and `auth.service.ts` reached for `redisClient`
directly, and worked only because the rate limiter's Redis store issued its
first command while `app.ts` was being imported. Remove or swap the limiter and
payments, caching and OTP would have broken silently.

All three now go through a small lazy facade in `lib/redis.ts` whose four
methods await `ensureRedis()` first. Verified by importing `cache.ts` on its own,
with no app and no limiter: miss, then a real Redis hit, then invalidate and
miss again.

### 9. Request ids

Every request gets a UUID, returned as the `x-request-id` header and in the body
of every error, so someone reporting a failure can quote one value that finds
it. Only genuinely unknown errors are logged, so a 401 does not print a novel.

This was briefly a JSON logger in `utils/logger.ts`. The reference has no logger
module and `rules/09-code-quality.md` specifies `console.error` with a tag, so
the helper was removed and every call site went back to a tagged `console.error`
— the request id rides along in it.

### 10. `FRONTEND_URL` pointed at localhost

The bKash callback used to redirect a real payer to `http://localhost:3000`.
The API serves its own result page at `GET /api/v1/payment/result` — a small
responsive HTML page that reads correctly on the phone the payer is holding — for
when no frontend is configured. With the frontend in place, `PAYMENT_RESULT_URL`
points at its `/payment/success` page and the callback redirects there instead.

### 11. Scheduled jobs

One set of jobs, two triggers, because the app runs in two shapes.

On Vercel, `node-cron` cannot work: a serverless instance sleeps between requests
and takes its timers with it. So `vercel.json` carries two cron entries that call
authenticated HTTP endpoints:

| job | schedule | who it emails |
| --- | --- | --- |
| `/api/v1/cron/meal-plan-reminder` | 16:00 UTC daily | active members of an open cycle with no plan set for tomorrow |
| `/api/v1/cron/unpaid-bill-reminder` | 04:00 UTC Mondays | members owing money on a closed cycle |

16:00 UTC is 22:00 in Dhaka, an hour before the meal-plan cutoff. The bill
reminder is weekly rather than daily on purpose — a daily email about the same
unpaid bill is a nag, not a reminder.

Both require `Authorization: Bearer $CRON_SECRET` and answer 503 if
`CRON_SECRET` is unset, so they are never open to the internet. Both accept
`?dryRun=true`, which reports exactly who would be emailed and sends nothing.

Run the app as a long-lived process instead — `pnpm start` on a VPS, or locally
for the real mess — and `lib/scheduler.ts` schedules the same two jobs with
`node-cron`, in `Asia/Dhaka` directly rather than UTC arithmetic. It is started
from `server.ts` only, which the serverless entry never imports, so the two
triggers can never both fire. Same `CronServices`, same times: 22:00 daily and
10:00 on Mondays, Dhaka.

### 12. Bills and receipts reach the members

Closing a cycle now emails every member their bill, and a settled payment emails
a receipt. Both carry a PDF built with `pdfkit` in `lib/pdf.ts` — one
`buildInvoicePdf` used by both, so the bill and the receipt look like the same
document.

Neither can undo money. The bill emails go out *after* the closing transaction
commits, and the receipt only after a payment is actually claimed — so a mail
failure is logged, never rolled back into the ledger. A replayed bKash callback
finds the payment already settled and sends no second receipt.

### 13. The bill reads like the mess's own sheet — **from the ledger**

The paper bill for August has a column each for meal, khala, utilities, deposit
and rent. The email had one lumped "utilities and other shared bills" line, and
merged the deposit into a single credit figure.

`computeSettlement` now returns `sharedBreakdown` — the member's share of each
expense type, ordered khala first, then gas, electricity, water, internet,
other — plus `depositTotal` and `paidExpenseTotal` kept apart instead of only
their sum. The email and the PDF itemise from that, and fall back to the single
line when a mess records nothing but groceries.

`tests/bill-breakdown.test.ts` replays August with khala, utilities and rent on
top of the groceries and checks the itemised lines add back to the totals, that
khala and utilities are per head while meals are not, and that the meal rate is
untouched by any of it.

### 14. Cash payments

`POST /api/v1/payment/record-cash-payment` — manager-only, `{ billId, amount,
note? }`. Most mess money is notes in a hand, and before this a bill could only
be cleared through bKash: once a cycle closed, cash had nowhere to go and the
weekly reminder nagged people who had already paid.

It runs the same arithmetic the bKash path does, refuses to overpay, and updates
the bill conditionally on the `paidAmount` it read, so two managers recording the
same cash at once cannot double-credit it. The `Payment` row carries
`paymentGateway: "cash"` — no migration, the column was already there — and the
member gets the same receipt with the method shown as cash.

### 15. Applying the plan no longer resurrects a deleted meal

`apply-to-register` looked for existing entries with `isDeleted: false`, so an
entry the manager had deliberately deleted was not counted as "already recorded"
and came back with the declared values. It now counts every row, deleted or not:
a deletion is a decision, and re-applying the plan respects it.

### 16. Emails are sent with a bounded concurrency

The cron jobs sent one email at a time, and the bill run sent all of them at
once. Both now go through `mapWithLimit` with a ceiling of four — fast enough
for a month's bills, gentle enough that Gmail does not start refusing
connections.

---

### 17. The rolling advance — **from the ledger**

The mess takes ৳600 from everyone at the start of each month and that money buys
the next month's bazaar, so the deposit is both a credit *and* a charge, landing
in different months. Whatever is unpaid rolls forward. MessMate settled every
cycle in isolation and charged no advance, so its bill could never match the
paper one.

`Mess.monthlyDeposit` holds what a mess charges (default `0`, so nothing changes
for a mess that does not do this). `computeSettlement` gained `openingBalance`
per member and `monthlyDeposit` on the input, and every bill now carries
`openingBalance` and `advanceCharged`:

```
totalPayable = openingBalance + mealCost + sharedCost + rentShare + advanceCharged
```

`closeCycle` reads the opening balance from the most recent **closed** cycle of
the same mess, ordered by year then month. Nothing new is stored — the previous
bill's `dueAmount` already is the figure.

Verified against Tarak's real August line: `totalPayable` ৳4,648.28 and
`dueAmount` ৳3,418.28 against the sheet's ৳3,425. The ৳6.72 gap is exactly
`33 × (49 − 48.7965)` — the mess rounds the rate by hand, and
`tests/bill-breakdown.test.ts` asserts that gap so the reason stays on the
record. `tests/rolling-advance.test.ts` carries a balance across three months.

Live: a mess with `monthlyDeposit: 600`, an empty month closing at ৳1,100 each
(rent 500 + advance 600), then the next month opening at exactly ৳1,100 with a
5.5-meal member billed ৳550.

### 18. Reopening a cycle tells the members

Reopening deletes the bills and rebuilds them, so anyone holding the emailed bill
was holding a figure that no longer existed. `reopenCycle` now reads the bills
before the transaction removes them and, once it commits, emails each member a
short notice naming the amount that has been withdrawn and confirming any
payment they already made still counts.

Same shape as the other mail: after the transaction, never inside it, and a
failure is logged rather than rolled back into the ledger.

### 19. Meal changes are on the record

The manager can put meals on anybody's account, change them, or delete them.
That is the design — the register is the manager's job, and there is deliberately
no cutoff on it, because what was eaten is the truth and it gets written down
after the fact.

But meals *are* money: one meal on someone's row is `mealRate` on their bill, and
because the total moves, everyone else's share shifts with it. Expense and
deposit deletions were audited; the meal register was not audited at all, so a
manager could move a member's cost with no record of who did it.

`AuditAction` gained `MEAL_RECORDED`, `MEAL_UPDATED` and `MEAL_DELETED`, and all
three meal writes now record the actor with the before/after counts —
`add-daily-meals` as one row per request, since one request is one decision.
Readable at `GET /api/v1/admin/audit-logs?entity=MealEntry`.

Nothing is taken away from the manager. The register is still theirs to fill;
it is just no longer anonymous.

### 20. The audit trail reaches the mess

Auditing meals only helps if the people it protects can see it, and
`GET /admin/audit-logs` is `ADMIN`-only — a platform operator who does not even
live in the mess. The manager, whose members' money it is, could see nothing.

`AuditLog` had no `messId` either, so opening the endpoint up would have shown
every mess's rows to everyone. The column is now there (nullable, cascading with
the mess), all ten mess-scoped writes stamp it, and the two platform-level ones —
role changed, user blocked — deliberately leave it null.

`GET /api/v1/mess/audit-logs/:messId` gives a manager their own mess and a `403`
on anyone else's, through the same `checkMessAccess` every other mess route uses.

### 21. Members read their own trail

The audit only protects a member if the member can see it, so
`AuditLog` gained `subjectMemberId` alongside `messId` — who a row is *about*,
not just who did it. Meals recorded, changed and deleted, a deposit deleted, a
payment settled, a member removed: all carry it. Closing a cycle touches
everybody and carries none.

`MEAL_RECORDED` used to be one row per request, which was tidy for the manager
but useless to a member — eight people's meals in one blob. It is now one row per
member, so a member's own history is a straight query on an indexed column.

The endpoint did not change; the role decides the scope. A manager gets the whole
mess and can narrow with `?memberId=`. A member gets only rows whose subject is
their own `MessMember` row, resolved server-side — passing someone else's
`?memberId=` changes nothing, which was checked live.

### 22. A running bill before the month closes

A member used to see their bill only once the manager closed the month, which is
when every argument started. `GET /api/v1/cycle/settlement-preview/:cycleId`
answers "what do I owe so far" at any point. Rather than a second, approximate
calculation, the ledger read that close-cycle does was pulled out of it into one
`loadSettlement` function that both call — close inside its transaction, the
preview outside any — so the two cannot disagree. Checked live: the previewed
bill and the bill close-cycle then wrote were identical field for field.

### 23. Default meals

Declaring every meal every day is the chore that makes a mess go back to paper.
`MessMember` gained `defaultLunch` and `defaultDinner` (both `0` by default, so
nothing changed for anyone who never sets them). A day with no plan counts at
the default; a plan always wins, 0/0 included. The calendars, the register fill
and the headcount all read that rule from one function, `defaultMealsFor`, which
has its own tests for joining and leaving mid-month. The evening reminder simply
skips anyone who has a default — they are already eating.

The hole this opens is a member lowering their default after a day has locked.
So a locked day's defaults are frozen into real `MealPlan` rows — by the nightly
headcount job for tomorrow, and by the default change itself for any already
locked day it would otherwise rewrite. Checked live: dropping a default from 1/1
to 0/0 left today at 1/1 and moved only tomorrow.

### 24. Tomorrow's headcount for the manager

`GET /api/v1/cron/meal-headcount`, at 23:05 Dhaka, just past the cutoff: it
freezes tomorrow's defaults, then emails each manager tomorrow's lunch and
dinner totals with a member-by-member table. The same numbers are
`cycle-calendar/:cycleId?date=` for anyone who would rather look than read
email. The cook still hears it from the manager; texting the cook directly needs
an SMS gateway and a phone number per mess, which is left for when it is asked
for.

### 25. An activity feed with unread counts

Deposits and expenses were audited only when deleted, so a member never saw the
manager record their money or the bazaar they fronted. `AuditAction` gained
`DEPOSIT_ADDED`, `DEPOSIT_UPDATED`, `EXPENSE_ADDED` and `EXPENSE_UPDATED`, each
written in the same transaction as the change, with the member it is about as
the subject — for an expense, the member who paid.

`MessMember.feedSeenAt` makes it a feed rather than a log:
`GET /api/v1/mess/activity-unread/:messId` counts what arrived in the caller's
own scope since then, leaving out their own actions, and
`PATCH /api/v1/mess/activity-seen/:messId` resets it. A member's scope did not
widen: an expense nobody fronted still reaches only the manager's view.

### 26. A personal income and expense tracker

A mess only covers part of a student's money. `/api/v1/finance` lets any user
keep their own income and spending and read it back by day, week, month or
year. It is deliberately separate: entries belong to the `User`, not a
membership, and paying a mess bill does not write into it.

Four decisions were settled up front. Categories are a fixed list per type, so
a report never splits "food" from "Food". A week runs Saturday to Friday, as it
does in Bangladesh. There are no wallets or accounts — only income and expense.
And the tracker is private to the point that another user's entry is a `404`,
not a `403`, so not even its existence leaks.

The summary is one `groupBy` over date, type and category, handed to a pure
`buildSummary` that adds in paisa and fills every day or month in the period,
empty ones as zero, so a chart has no gaps. Checked live: entries today,
yesterday and last month moved each period by exactly the right amount, the
week began on Saturday the 12th, a manager got `404` on a member's entry, and a
deleted entry left every summary.

### 27. One rate-limit budget for the whole site

Behind Vercel every request arrived from the proxy's address, so the limiter
counted the whole site against one 300-request budget and started answering
`429` to everybody after a few minutes of real use. The app now trusts Vercel's
`X-Forwarded-For` (`trust proxy` set to one hop), a signed-in request counts
against its user, and a login or password-reset attempt against the IP and the
account together. Checked live: the remaining count fell by exactly one per
request.

### 28. Nobody becomes a manager by signing up

Anyone could register as "I run a mess" and get a manager's routes. Now that
choice files a `ManagerApplication` with the mess's name and address, and the
account stays a member until an admin approves it — the role changes, the next
token refresh carries it — or rejects it with a reason. Both answers are emailed
and audited (`MANAGER_APPROVED`, `MANAGER_REJECTED`). A member can apply later
from their profile; every application is kept, one pending at a time.

A manager also runs exactly one mess now: `create-mess` answers `409` while they
have one, and deleting it frees them to start another.

### 29. Nobody joins a mess without agreeing to it

`POST /member/add-member` put anyone with an account into a mess on the
manager's word: their name, email and phone shown to strangers, meals and rent
charged in their name. It is gone. Every mess has a six-character join code; a
member asks with it and the manager approves or declines, or the manager invites
by email and the member accepts or declines. Invitations and requests live in
`MembershipRequest`, not in a new member status, because a dozen reads only
check `isDeleted` and a "pending" member would have been billed. A member can
leave on their own once their bills are paid (`MEMBER_JOINED`, `MEMBER_LEFT`).

### 30. A carried balance is paid once

Found while building the demo data. The rolling advance carries last month's
balance into the new bill — but the old bill still asked for the same money, so
a member could pay it twice, the weekly reminder counted it twice, and the
admin's outstanding total double-counted it. Closing a month now marks every
bill it opened with as `CARRIED` with nothing due. Reopening that month gives
each one its balance back, and an older month can no longer be reopened while a
later one is closed on top of it, since that would recompute a balance the later
month already used.

### 31. Only the people who were there share a month

Found the same way. The settlement took everyone who had ever left as well as
everyone active, so a member who moved out in September paid an equal share of
October's khala, gas and internet, and got a bill for it. Now someone with no
day in the month and nothing recorded in it is left out.

### 32. Demo data

`pnpm seed:demo` prints a plan — every member's newest bill, computed by the
same `computeSettlement` — and `--write` builds it: three messes, twelve members
each showing one case, three closed months and the current one open, plus a
pending join request, invitation and manager application. Months close and cash
is paid through the real services, so the numbers are the ones the app would
produce. A rerun resets the demo, and the Postman collection gets its own
manager and member so a run never touches it. `.test` addresses are never
mailed, so neither the seed nor the reminder crons bounce.

---

## Still open

**Error tracking.** Logs are structured now, but nothing aggregates them.
Sentry or similar needs an account and a DSN.

**Email links follow `FRONTEND_URL`.** It is used for the `/login` links in
welcome, reminder and bill emails and for Stripe's return URLs, so production
needs it set to the deployed frontend's origin — on localhost those links only
work on the developer's machine.

**A rounded meal rate.** The mess works to ৳49 a meal where MessMate keeps
৳48.7965, so every hand-written bill sits a few taka above the computed one — for
Tarak, ৳6.72. Rounding up over 282.5 meals collects ৳57.50 more than the
groceries actually cost, which is a deliberate buffer on paper but would break
the invariant that `Σ mealCost === groceryTotal` exactly. Supporting it means a
per-mess rounding setting *and* somewhere for the surplus to live. Left alone
until that is decided, because it is a money policy, not a bug.

**A gateway payment that lands after its bill was carried.** If a member starts a
card or bKash checkout and the manager closes the next month before the payment
completes, the late settlement credits the old bill and flips it out of
`CARRIED`, while the new bill still holds the same balance. It needs a checkout
open across a month close, so it is rare; the fix is to settle such a payment
against the newest bill instead.

**An invitation tells the manager whether an email has an account.** An unknown
address answers `404` and a member of the mess `409`. Only a manager can invite
and the route is rate limited, so it is left as is.

**Rejoining resets `joinedAt`.** A member who left and is accepted back starts a
fresh tenure, so a later month prorates rent from the day they came back. That
is what rent should do; the original join date survives only in the audit trail.

---

## Staying manual on purpose

**Closing a billing cycle.** It finalises money, and only the manager knows every
expense is in. A clock closing the month would bill an incomplete ledger.
