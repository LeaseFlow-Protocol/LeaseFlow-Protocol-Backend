# Late Fee Enforcement

## Overview

Automated late fee enforcement removes the need for landlord–tenant confrontation over missed rent. When rent isn't paid by the due date, a daily cron job detects the overdue payment, calculates a fee based on the lease's late-fee terms, and submits the accrued `pending_debt` to the Soroban smart contract on-chain.

## How It Works

1. **Rent payments** are tracked in the `rent_payments` table with a `due_date` and `status`.
2. **Late fee terms** are configured per lease in the `late_fee_terms` table (daily rate, grace period, optional cap).
3. A **daily cron job** (`LateFeeJob`) runs at midnight UTC (configurable) and:
   - Queries all `pending` rent payments whose `due_date` is before the current date on active leases.
   - For each overdue payment, calculates incremental late fees based on the number of days late and the lease's `daily_rate`.
   - Records each assessment in the `late_fee_ledger`.
   - Submits a `pending_debt` update to the Soroban lease contract via `SorobanLeaseService.updatePendingDebt()`.
   - Notifies both tenant and landlord.

## Database Tables

### `late_fee_terms`

| Column               | Type        | Description                                       |
| -------------------- | ----------- | ------------------------------------------------- |
| `id`                 | TEXT PK     | Unique identifier                                 |
| `lease_id`           | TEXT UNIQUE | Associated lease                                  |
| `daily_rate`         | INTEGER     | Fee per day late (in smallest currency unit)      |
| `grace_period_days`  | INTEGER     | Days after the 1st before fees start (default: 5) |
| `max_fee_per_period` | INTEGER     | Optional cap per billing period                   |
| `enabled`            | INTEGER     | Whether enforcement is active                     |

### `rent_payments`

| Column        | Type    | Description                      |
| ------------- | ------- | -------------------------------- |
| `id`          | TEXT PK | Unique identifier                |
| `lease_id`    | TEXT    | Associated lease                 |
| `period`      | TEXT    | Billing period (e.g., `2026-03`) |
| `due_date`    | TEXT    | Payment due date                 |
| `amount_due`  | INTEGER | Rent amount owed                 |
| `amount_paid` | INTEGER | Amount received                  |
| `date_paid`   | TEXT    | When payment was received        |
| `status`      | TEXT    | `pending` / `paid` / `partial`   |

### `late_fee_ledger`

| Column               | Type    | Description                                   |
| -------------------- | ------- | --------------------------------------------- |
| `id`                 | TEXT PK | Unique identifier                             |
| `lease_id`           | TEXT    | Associated lease                              |
| `rent_payment_id`    | TEXT    | The overdue payment                           |
| `period`             | TEXT    | Billing period                                |
| `days_late`          | INTEGER | Days overdue at assessment time               |
| `daily_rate`         | INTEGER | Rate applied                                  |
| `fee_amount`         | INTEGER | Cumulative fee for this entry                 |
| `pending_debt_total` | INTEGER | Running total of all late fees for this lease |
| `soroban_tx_status`  | TEXT    | `pending` / `confirmed` / `failed`            |
| `soroban_tx_hash`    | TEXT    | On-chain transaction hash                     |
| `assessed_at`        | TEXT    | Date the fee was assessed                     |

## API Endpoints

### `GET /api/late-fees/:leaseId`

Returns the late fee summary and all ledger entries for a lease.

### `POST /api/late-fees/assess`

Manually triggers a late fee assessment pass. Accepts optional `{ "asOfDate": "YYYY-MM-DD" }` in the body.

## Configuration

| Environment Variable   | Default     | Description                                      |
| ---------------------- | ----------- | ------------------------------------------------ |
| `LATE_FEE_JOB_ENABLED` | `false`     | Set to `true` to start the cron scheduler        |
| `LATE_FEE_CRON`        | `0 0 * * *` | Cron expression (default: daily at midnight UTC) |

## Running Tests

```bash
npm test -- --testPathPatterns=lateFee
```
