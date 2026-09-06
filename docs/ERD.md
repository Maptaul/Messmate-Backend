# MessMate — Entity Relationship Diagram

12 models, one per schema file under `prisma/schema/`. Generated from the actual
schema, so the diagram and the database cannot drift apart.

```mermaid
erDiagram
    User ||--o{ MessMember : "lives in"
    User ||--o{ Mess : manages
    User ||--o{ AuditLog : "acted"

    Mess ||--o{ MessMember : has
    Mess ||--o{ BillingCycle : "one per month"

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
    }
    MessMember {
        string id PK
        string messId FK
        string userId FK
        MemberStatus status
        datetime joinedAt
        datetime leftAt
    }
    BillingCycle {
        string id PK
        string messId FK
        int year
        int month
        CycleStatus status
        decimal mealRate
    }
    MealEntry {
        string id PK
        date date
        int lunch
        int dinner
    }
    MealPlan {
        string id PK
        date date
        int lunch
        int dinner
    }
    Expense {
        string id PK
        ExpenseType type
        decimal amount
        SplitMethod splitMethod
        string paidByMemberId FK
    }
    Deposit {
        string id PK
        decimal amount
    }
    GroceryDuty {
        string id PK
        date startDate
        date endDate
    }
    MemberBill {
        string id PK
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
        string bkashPaymentId UK
        string bkashTrxId
    }
    AuditLog {
        string id PK
        AuditAction action
        string entity
        json before
        json after
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

Nothing is hard-deleted through the API. `isDeleted` + `deletedAt` mark a row and
every read filters them out. Money is `Decimal`, never `Float`.
