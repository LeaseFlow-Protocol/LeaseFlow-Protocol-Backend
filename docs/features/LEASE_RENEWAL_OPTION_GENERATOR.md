# Lease Renewal Option Generator

## Overview

This feature adds an automated backend workflow that scans active leases approaching expiry, generates renewal proposals from landlord-defined rules, notifies both parties, and prepares the next Soroban lease contract payload after mutual acceptance.

## 60-Day Scan Behavior

- The renewal scan runs through `LeaseRenewalJob`.
- The job evaluates active, renewable, non-disputed leases.
- By default, a lease is eligible when it is exactly `notice_days` away from expiry.
- `LEASE_RENEWAL_SCAN_WINDOW_DAYS` can widen the lower bound if operations want a small grace window.

## Renewal Rule Application

Each landlord can define one renewal rule with:

- `increase_type`: `percentage`, `fixed`, or `same`
- `increase_value`
- `term_months`
- `notice_days`
- `enabled`

The backend computes proposed terms on the server. Clients do not supply new rent or renewal dates.

## Duplicate Prevention / Idempotency

- Renewal proposals are keyed by `lease_id + target_start_date`.
- The scan checks for an existing proposal for the same renewal cycle before generating a new one.
- Re-running the job for the same day is safe and does not create duplicates.

## Notification Flow

When a proposal is generated, the backend persists one notification for:

- the landlord
- the tenant

Each notification includes the lease reference, proposal reference, and a concise summary message.

## Agreement Flow

Available routes:

- `GET /renewal-proposals/:proposalId`
- `POST /renewal-proposals/:proposalId/accept`
- `POST /renewal-proposals/:proposalId/reject`

Only the proposal's landlord or tenant can view or act on it.

Status progression:

- `generated`
- `landlord_accepted`
- `tenant_accepted`
- `fully_accepted`
- `contract_prepared`
- `rejected`
- `expired`

## Soroban Contract Preparation

Once both parties accept:

- the backend prepares the next Soroban lease contract reference
- the proposal is marked `contract_prepared` when successful
- if preparation fails, the proposal remains `fully_accepted` and `soroban_contract_status` becomes `failed`

Tests mock Soroban behavior and do not require a live network.

## Scheduling Notes

- Enable automatic scheduling with `LEASE_RENEWAL_JOB_ENABLED=true`.
- The interval is configured with `LEASE_RENEWAL_JOB_INTERVAL_MS`.
- The default interval is once every 24 hours.

## Security Considerations

- Proposal ownership is enforced by signed bearer tokens and lease participant checks.
- Landlords and tenants can only act on proposals tied to their own lease.
- Renewal terms are server-generated from stored rules.
- Duplicate generation is prevented for the same lease cycle.
- Mutual acceptance is required before Soroban preparation.

## Limitations / Future Extensions

- The repository did not include an existing DB, notification bus, scheduler, or Soroban deployment stack, so this feature adds a focused SQLite-backed implementation and an injectable Soroban preparation service.
- Automatic expiration sweeps can be added later if proposal expiry needs active enforcement.
- If the project adopts a richer auth or job platform later, the current services provide clear seams for integration.
