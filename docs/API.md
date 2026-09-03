# MessMate API Reference

**Base URL:** `https://messmatebackend.vercel.app`
**Local:** `http://localhost:5000`

62 endpoints across 12 modules, all versioned under `/api/v1`. The runnable
version of this document is `postman/MessMate.postman_collection.json` — 91
requests that chain their own tokens and ids, verified against the live
deployment (83 passed, 0 failed, 8 manual).

---

## Authentication

Bearer token in the `Authorization` header, or the `accessToken` cookie:

```http
Authorization: Bearer <accessToken>
```

`POST /api/v1/auth/login` returns the access token and sets a refresh cookie.
**Role and account status are re-read from the database on every request** — a
token alone never proves what someone is allowed to do, so a demotion or a block
takes effect immediately without waiting for the token to expire.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| `ADMIN` | `admin@messmate.app` | provided at submission |
| `MESS_MANAGER` | `manager@messmate.app` | provided at submission |
| `MEMBER` | `member@messmate.app` | provided at submission |

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
  "errors": [{ "field": "email", "message": "Not a valid email" }]
}
```

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

List endpoints accept `?page=` and `?limit=` (default 1 and 10), `?sortBy=` and
`?sortOrder=asc|desc`. Where a search makes sense — messes, members, expenses,
meals, users — `?searchTerm=` matches the relevant text fields
case-insensitively. Domain filters are per endpoint: `?role=` and `?status=` on
users, `?type=` on expenses, `?memberId=` on meals and deposits, `?action=` and
`?entity=` on audit logs.

---

## Endpoints

### Auth — `/api/v1/auth`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/auth/register` | _public_ | yes |  |
| POST | `/api/v1/auth/verify-email` | _public_ | yes |  |
| POST | `/api/v1/auth/login` | _public_ | yes |  |
| POST | `/api/v1/auth/google` | _public_ | yes |  |
| POST | `/api/v1/auth/refresh-token` | _public_ | — |  |
| POST | `/api/v1/auth/logout` | _public_ | — |  |
| POST | `/api/v1/auth/forgot-password` | _public_ | yes |  |
| POST | `/api/v1/auth/reset-password` | _public_ | yes |  |
| GET | `/api/v1/auth/me` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### User — `/api/v1/user`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| PATCH | `/api/v1/user/update-profile` | `ADMIN` `MESS_MANAGER` `MEMBER` | yes |  |
| PATCH | `/api/v1/user/profile-image` | `ADMIN` `MESS_MANAGER` `MEMBER` | — | multipart/form-data |
| DELETE | `/api/v1/user/profile-image` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Mess — `/api/v1/mess`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/mess/create-mess` | `MESS_MANAGER` | yes |  |
| GET | `/api/v1/mess/all-messes` | `ADMIN` | — |  |
| GET | `/api/v1/mess/my-messes` | `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/mess/update-mess/:messId` | `ADMIN` `MESS_MANAGER` | yes |  |
| DELETE | `/api/v1/mess/delete-mess/:messId` | `ADMIN` `MESS_MANAGER` | — |  |
| GET | `/api/v1/mess/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Member — `/api/v1/member`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/member/add-member` | `ADMIN` `MESS_MANAGER` | yes |  |
| GET | `/api/v1/member/my-memberships` | `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/member/mess-members/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| PATCH | `/api/v1/member/remove-member/:memberId` | `ADMIN` `MESS_MANAGER` | — |  |

### Billing Cycle — `/api/v1/cycle`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| POST | `/api/v1/cycle/open-cycle` | `ADMIN` `MESS_MANAGER` | yes |  |
| GET | `/api/v1/cycle/mess-cycles/:messId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
| POST | `/api/v1/cycle/close-cycle/:cycleId` | `ADMIN` `MESS_MANAGER` | — |  |
| POST | `/api/v1/cycle/reopen-cycle/:cycleId` | `ADMIN` | — |  |
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
| GET | `/api/v1/meal-plan/my-calendar/:cycleId` | `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/meal-plan/cycle-calendar/:cycleId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |
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
| GET | `/api/v1/payment/my-bills` | `MESS_MANAGER` `MEMBER` | — |  |
| POST | `/api/v1/payment/create-payment` | `MESS_MANAGER` `MEMBER` | yes |  |
| GET | `/api/v1/payment/my-payments` | `MESS_MANAGER` `MEMBER` | — |  |
| GET | `/api/v1/payment/:paymentId` | `ADMIN` `MESS_MANAGER` `MEMBER` | — |  |

### Admin — `/api/v1/admin`

| Method | Path | Roles | Validated | Notes |
| --- | --- | --- | :-: | --- |
| GET | `/api/v1/admin/dashboard-stats` | `ADMIN` | — |  |
| GET | `/api/v1/admin/audit-logs` | `ADMIN` | — |  |
| GET | `/api/v1/admin/users` | `ADMIN` | — |  |
| GET | `/api/v1/admin/users/:userId` | `ADMIN` | — |  |
| PATCH | `/api/v1/admin/users/:userId/role` | `ADMIN` | yes |  |
| PATCH | `/api/v1/admin/users/:userId/status` | `ADMIN` | yes |  |

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

The callback is a public GET whose query string arrives through the user's own
browser, so nothing it claims is trusted. Settlement requires all four of
`statusCode 0000`, `transactionStatus Completed`, `currency BDT` and an amount
matching the row we created, and it runs behind a conditional update so a
refreshed callback credits the bill once.

---

## Notes for evaluators

- **Soft deletes.** Nothing is removed from the database. `DELETE` endpoints set
  `isDeleted` and `deletedAt`, and every read filters them out.
- **Audit log.** Cycle closed and reopened, member removed, expense and deposit
  deleted, payment settled, role changed, user blocked and unblocked — each with
  the actor and the before/after state, readable at `GET /api/v1/admin/audit-logs`.
- **Two-layer authorization.** `auth(...)` proves the account type;
  `checkMessAccess` proves the mess is the caller's. Both are required on any
  route that takes a `messId` or a `cycleId`.
