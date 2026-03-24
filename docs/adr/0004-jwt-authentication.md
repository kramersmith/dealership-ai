# ADR-0004: JWT Authentication

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

The Dealership AI app needs authentication for both the mobile app (iOS/Android) and web client. The backend is a stateless FastAPI service that may be deployed behind a load balancer on platforms like Railway or Fly.io. Key requirements:

- Stateless — no server-side session storage needed, works across multiple backend instances
- Mobile-friendly — tokens stored securely on device, sent as headers (no cookies)
- Simple to implement for MVP — the app has a single backend, no federated identity, no third-party login providers (yet)
- Secure password storage

The user model is straightforward: email + password signup, with a role field (buyer or dealer) that determines which app experience is shown.

## Decision

Use JWT (JSON Web Tokens) with HS256 signing and bcrypt password hashing:

- **Token format:** HS256-signed JWT containing `sub` (user ID) and `exp` (expiration) claims
- **Token lifetime:** 8 hours (`ACCESS_TOKEN_EXPIRE_MINUTES = 480`), balancing security with mobile UX (users should not need to re-login during a car buying session)
- **Signing key:** `SECRET_KEY` from environment variables, shared across all backend instances
- **Password hashing:** bcrypt via the `bcrypt` library with automatic salt generation
- **Token delivery:** Returned in the login/signup response body; client stores it and sends it as `Authorization: Bearer <token>` on subsequent requests
- **Token validation:** FastAPI dependency (`get_current_user`) decodes and validates on every protected endpoint

No refresh token mechanism in the MVP. When the token expires, the user logs in again.

## Alternatives Considered

### Option A: Session-based authentication (server-side sessions)
- Pros: Easy to revoke (delete the session row), familiar pattern, no token size concerns
- Cons: Requires server-side session storage (database or Redis), which adds infrastructure complexity. Does not scale horizontally without shared session storage. Cookie-based sessions are awkward for mobile apps (native HTTP clients handle cookies poorly). Contradicts the stateless backend goal.

### Option B: OAuth 2.0 / OpenID Connect (e.g., Auth0, Supabase Auth)
- Pros: Industry standard, supports social login (Google, Apple), handles token refresh and revocation, battle-tested security
- Cons: Significant added complexity for MVP — requires integration with an external provider, redirect flows, token exchange. The app has no social login requirement yet. Adds a dependency and potential cost. Can be adopted later if the app needs federated identity or social login.

### Option C: API keys (static tokens per user)
- Pros: Simplest possible implementation
- Cons: No expiration without manual revocation, no standard claims structure, poor security posture if a key is leaked, not suitable for end-user authentication (more appropriate for service-to-service)

### Option D: RS256 (asymmetric) JWT signing
- Pros: Backend can verify tokens without knowing the signing key (useful for microservices where only the auth service has the private key)
- Cons: Unnecessary complexity for a single-backend architecture. HS256 is simpler and faster. RS256 becomes valuable only if token verification needs to happen in separate services that should not have the signing secret.

## Consequences

- **Positive:** Fully stateless — no session table, no Redis, no shared state between backend instances. Horizontal scaling is trivial.
- **Positive:** Mobile-friendly — the token is a simple string stored in device secure storage and sent as a header. No cookie management.
- **Positive:** bcrypt with automatic salting provides strong password hashing resistant to rainbow table and brute-force attacks.
- **Positive:** Simple implementation — the entire auth layer is ~35 lines of code (`security.py`) using `python-jose` and `bcrypt`.
- **Negative:** No token revocation. If a token is compromised, it remains valid until expiration (up to 8 hours). Mitigation: the 8-hour window limits exposure, and a token blocklist can be added later if needed.
- **Negative:** No refresh token flow. Users must re-authenticate after 8 hours. Acceptable for MVP since car buying sessions are typically shorter, but a refresh token should be added before production launch.
- **Negative:** HS256 requires the `SECRET_KEY` to be present on every backend instance and kept strictly confidential. If the key leaks, all tokens can be forged.
- **Neutral:** The JWT structure (`sub` + `exp`) is minimal and can be extended with additional claims (e.g., `role`, `email`) if needed without breaking existing tokens.

## References

- [Backend security implementation](../../apps/backend/app/core/security.py)
- [Backend plan — config and auth routes](../backend-plan.md)
- [JWT RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
- [OWASP: Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
