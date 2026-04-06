# ADR-0014: Confirmed VIN Decode Promotion

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

ADR-0008 established the vehicle intelligence integration and originally documented an immediate merge-back pattern: after a successful VIN decode, decoded fields were promoted into the parent `Vehicle` row right away.

That behavior no longer matches the product's identity-confirmation flow:

1. Buyers can submit or intercept a VIN before verifying that it actually matches the vehicle they mean.
2. Provider-derived decode results are useful intelligence, but they are not the same thing as confirmed canonical vehicle identity.
3. Promoting unconfirmed decode fields into the main `Vehicle` row leaks provider guesses into session titles, prompt state, and buyer-visible summaries before the user has validated the match.
4. Once the panel and chat loop became more state-driven, keeping the canonical `Vehicle` row limited to user-stated or user-confirmed identity became more important. A mistyped VIN should not silently rewrite the session's source-of-truth vehicle.

ADR-0008 remains correct about the provider split, TTL strategy, append-only intelligence records, and identity confirmation as a product concept, but its immediate merge-back rule is now incorrect.

## Decision

Treat VIN decode results as intelligence records until the user explicitly confirms them.

### 1. Decode first, promote later

During `decode_vin()`:

- persist the `VehicleDecode` intelligence record as before
- update the parent `Vehicle` row only with the normalized VIN
- do **not** promote decoded year/make/model/trim/engine into the canonical `Vehicle` row yet

This keeps raw provider output available while preserving the distinction between fetched intelligence and confirmed identity.

### 2. Promotion happens on explicit confirmation

When the user confirms the vehicle identity:

- mark `identity_confirmation_status` as `confirmed`
- apply the latest decode to the canonical `Vehicle` row via a dedicated confirmation step
- keep the append-only `VehicleDecode` record as the source audit trail

If the user rejects the decode, the intelligence record remains stored for debugging and auditability, but it is not promoted into canonical vehicle identity.

### 3. Canonical vehicle state must stay grounded

The main `Vehicle` row is the source of truth for user-facing identity fields used by titles, prompts, and structured deal state. Those fields may come from:

- facts the user stated directly
- facts already stored on the `Vehicle` row
- provider decode fields only after explicit user confirmation

This decision supersedes the merge-back rule described in ADR-0008.

## Alternatives Considered

### Option A: Keep immediate merge-back from ADR-0008
- Pros: Vehicle displays become richer immediately after decode. Less confirmation-specific backend logic.
- Cons: Incorrect VINs can silently overwrite the canonical vehicle identity. Prompt state and titles can become wrong before the user validates the decode.

### Option B: Never promote decode fields into the canonical `Vehicle` row
- Pros: Maximum separation between provider intelligence and canonical state.
- Cons: Confirmed VIN decodes would remain trapped in intelligence tables, forcing every consumer to stitch together confirmed identity indirectly.

### Option C: Promote decode fields only after explicit confirmation (chosen)
- Pros: Preserves auditability, keeps canonical state grounded, and still allows confirmed decode data to power titles, prompts, and panel cards after the user validates the match.
- Cons: Adds one more transition in the identity-confirmation flow and requires explicit promotion logic.

## Consequences

- **Positive:** Mistyped or mismatched VINs no longer rewrite the canonical vehicle identity before the buyer confirms them.
- **Positive:** Session titles, prompt state, and structured deal state stay aligned with user-stated or user-confirmed facts.
- **Positive:** The intelligence tables still preserve full provider output and audit history.
- **Negative:** Vehicle identity may remain partially populated after decode until the buyer confirms it.
- **Neutral:** ADR-0008 should now be read together with this ADR for decode-promotion behavior.

## References

- [ADR-0008: Vehicle intelligence external API integrations](0008-vehicle-intelligence-integrations.md)
- [Vehicle intelligence service](../../apps/backend/app/services/vehicle_intelligence.py)
- [Vehicle identity confirmation route](../../apps/backend/app/routes/deals.py)