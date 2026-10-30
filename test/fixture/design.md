# Goldfish review fixture: local cache design

## Problem

The service recomputes every report on each request. Under load, the same
report is built many times per minute.

## Proposal

Add an in-process cache keyed by report ID. The cache holds at most 500
entries. An entry expires after ten minutes.

## Interfaces

- `getReport(id: string): Promise<Report>`
- `invalidate(id: string): void`

## Invariants

- A cached report is never older than ten minutes.
- An invalidation removes the entry before it returns.

## Side effects

The cache writes no files. It emits one counter per hit and one per miss.

## Open questions

Should the cache be shared across worker processes?
