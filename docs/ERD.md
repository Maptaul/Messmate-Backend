# MessMate — Entity Relationship Diagram

13 models, one per schema file under `prisma/schema/`, and all 25 of their
relations. The diagram is written by hand, so it can drift from the schema — it
was last checked foreign key by foreign key: every `@relation` in
`prisma/schema/` is drawn below, and every line below is a real `@relation`.

```mermaid
erDiagram
    User ||--o{ MessMember : "lives in"
    User ||--o{ Mess : manages
    User ||--o{ AuditLog : "acted"
    User |o--o{ BillingCycle : "closed"
    User ||--o{ Deposit : "recorded"
    User ||--o{ Expense : "recorded"
    User ||--o{ FinanceEntry : "keeps"

    Mess ||--o{ MessMember : has
    Mess ||--o{ BillingCycle : "one per month"
    Mess ||--o{ AuditLog : "is audited in"

    BillingCycle ||--o{ MealEntry : records
    BillingCycle ||--o{ MealPlan : declares
    BillingCycle ||--o{ Expense : holds
    BillingCycle ||--o{ Deposit : holds
    BillingCycle ||--o{ GroceryDuty : schedules
    BillingCycle ||--o{ MemberBill : "settles into"

    MessMember ||--o{ MealEntry : ate
    MessMember ||--o{ MealPlan : planned
    MessMember ||--o{ Deposit : paid
    MessMember |o--o{ Expense : "fronted cash for"
    MessMember ||--o{ GroceryDuty : "on duty"
    MessMember ||--o{ MemberBill : owes
    MessMember ||--o{ Payment : made
    MessMember |o--o{ AuditLog : "is the subject of"

    MemberBill ||--o{ Payment : "paid by"

    User {
        string id PK
        string email UK
        Role role
        UserStatus status
    }
    Mess {
        string id PK
        string managerId FK
        decimal monthlyRent
        decimal monthlyDeposit
    }
    MessMember {
        string id PK
        string messId FK
        string userId FK
        MemberStatus status
        datetime joinedAt
        datetime leftAt
        float defaultLunch
        float defaultDinner
        datetime feedSeenAt
    }
    BillingCycle {
        string id PK
        string messId FK
        string closedById FK
        int year
        int month
        CycleStatus status
        float totalMeals
        decimal mealRate
    }
    MealEntry {
        string id PK
        date date
        float lunch
        float dinner
    }
    MealPlan {
        string id PK
        date date
        float lunch
        float dinner
    }
    Expense {
        string id PK
        ExpenseType type
        decimal amount
        SplitMethod splitMethod
        string paidByMemberId FK
        string createdById FK
    }
    Deposit {
        string id PK
        decimal amount
        string createdById FK
    }
    GroceryDuty {
        string id PK
        date startDate
        date endDate
    }
    MemberBill {
        string id PK
        float mealCount
        decimal totalPayable
        decimal creditAmount
        decimal paidAmount
        decimal dueAmount
        BillStatus status
    }
    Payment {
        string id PK
        decimal amount
        PaymentStatus status
        string paymentGateway
        string bkashPaymentId UK
        string bkashTrxId
    }
    AuditLog {
        string id PK
        AuditAction action
        string entity
        string actorId FK
        string messId FK
        string subjectMemberId FK
        json before
        json after
    }
    FinanceEntry {
        string id PK
        string userId FK
        FinanceEntryType type
        FinanceCategory category
        decimal amount
        date date
    }
```

Three relationships carry most of the design:

- **`MessMember` sits between `User` and `Mess`.** One person can live in more
  than one mess, and every meal, expense and bill hangs off the membership
  rather than the user — so someone who leaves keeps their history in the months
  they were there.
- **`BillingCycle` owns the month.** Meals, plans, expenses, deposits and duty
  all belong to a cycle, which is what makes closing the month a single,
  well-defined operation.
- **`MealPlan` and `MealEntry` are deliberately separate.** A plan is what a
  member declared in advance; an entry is what the manager recorded as eaten.
  Only entries are charged. Merging them would let a declaration quietly become
  a charge.

`FinanceEntry` hangs off `User`, not `MessMember`, on purpose: a person's own
income and spending belong to them, not to whichever mess they live in, and
survive moving out.

## The audit trail

An `AuditLog` row answers three questions, and each has its own column:

| Column | Answers | Set on |
| --- | --- | --- |
| `actorId` | who did it | every row |
| `messId` | which mess it happened in | every mess-scoped row |
| `subjectMemberId` | who it was about | rows about one person |

The two optional columns are what let the same table serve three readers. The
platform admin reads everything. A manager reads the rows where `messId` is
theirs. A member reads only the rows where `subjectMemberId` is their own
membership — the meal a manager recorded against them, a deposit of theirs
deleted, a payment of theirs settled.

Closing or reopening a cycle touches every member at once, so it carries a
`messId` but no subject, and never appears in a member's view. A role change or a
block is a platform action with neither, so it never reaches any mess view.

`subjectMemberId` points at `MessMember`, not `User`, for the same reason
everything else does: a person in two messes has two memberships, and a meal in
one mess is nothing to do with the other.

## Constraints that carry meaning

| Constraint | Prevents |
| --- | --- |
| `BillingCycle(messId, year, month)` | two ledgers for one month |
| `MealEntry(memberId, date)` | double-counting a day |
| `MealPlan(memberId, date)` | two declarations for the same day |
| `MemberBill(cycleId, memberId)` | two bills for one member |
| `Payment.bkashPaymentId` | a replayed callback creating a second payment |

## Deletion rules

Most children cascade from `BillingCycle`, so removing a mess removes the months
under it rather than leaving orphans. `Payment` cascades from its `MemberBill`,
because reopening a cycle deletes the bills so the settlement can be regenerated
— a settled payment never reaches that path, since reopen is refused once any
payment lands against the month.

`AuditLog` cascades from its `Mess` and its subject `MessMember`, so a deleted
mess takes its trail with it. Its `actorId` does the opposite — `ON DELETE
RESTRICT` — so the database refuses to remove a user who has acted while that
trail exists. The same holds for whoever recorded a deposit or an expense: a
record of who did something is worth nothing if deleting them could erase it. In
practice it never comes up, because accounts are soft-deleted and the row stays.

`BillingCycle.closedById` is the one exception, and it is `SET NULL` on purpose:
a closed month has to survive losing the name of whoever closed it.

Nothing is hard-deleted through the API. `isDeleted` + `deletedAt` mark a row and
every read filters them out.

Money is `Decimal`, never `Float`. Meal counts are the one deliberate `Float` —
`MealEntry.lunch`/`.dinner`, `MealPlan.lunch`/`.dinner`,
`MemberBill.mealCount` and `BillingCycle.totalMeals`: a real register records
half meals, and multiples of `0.5` are exact in binary floating point, so nothing
drifts. Validation enforces that step — a mess has half meals, not thirds.
