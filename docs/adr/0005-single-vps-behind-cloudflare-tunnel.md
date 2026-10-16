# ADR 0005: Deployment on One VPS Behind a Cloudflare Tunnel

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** Project owner (with AI-assisted analysis)

## Summary

**Decision:** Production is one Linux VPS that runs the Docker Compose stack (Postgres, the API, and nginx with the UI) plus `cloudflared`. Cloudflare serves `workout.albertnguyen.dev`. It handles TLS, caches the hashed assets, applies a WAF rate rule, and sends requests through an outbound-only tunnel. No container publishes a port. GitHub Actions tests every change, builds images tagged with the commit SHA into GHCR, and deploys them over SSH, rolling back automatically if a release isn't healthy. A nightly `pg_dump` goes to Cloudflare R2.

**Why:** The app is a demo for reviewers, with no uptime promise. One VPS costs about $5–12 a month and runs the same Compose stack that the tests and the reviewers already use. The domain's DNS is already on Cloudflare, so TLS, DDoS protection and the tunnel cost nothing. The tunnel also removes inbound HTTP ports and origin certificates.

## Context

- The brief grades production readiness (Docker setup, structured logging, configuration management, performance awareness) and asks for no authentication: `userId` is a parameter.
- `albertnguyen.dev` uses Cloudflare nameservers.
- The UI calls the API only through same-origin `/api/*` (nginx in Docker), so one hostname serves both without CORS.
- Writes are public and unauthenticated, so anyone can add data for any `userId`.

## Options Considered

| Option | Cost per month | For | Against |
| --- | --- | --- | --- |
| **One VPS + Cloudflare Tunnel (chosen)** | ~$5–12 | The same stack as local and CI; no open HTTP ports; TLS, WAF and R2 at no cost | One point of failure; we patch the OS and run the backups |
| PaaS (Fly.io, Render, Railway) + managed Postgres | ~$15–30 | Managed backups and restarts | Platform-specific configuration; the nginx proxy and Compose stack must be reworked for the platform |
| AWS ECS Fargate + RDS + S3/CloudFront | ~$50–80 | Several instances, a managed database, autoscaling | The most setup and cost; the DNS is not on AWS |

## Decision Details

- **Hostname:** `workout.albertnguyen.dev`, with the UI at `/` and the API at `/api/*`. Universal SSL covers one level of subdomain.
- **Path:** Cloudflare edge → tunnel → `cloudflared` → nginx (`web`) → API → Postgres. The VPS firewall allows only SSH, with keys only.
- **Abuse limits:** nginx limits each client, keyed by `CF-Connecting-IP`, to 20 API requests a second (burst 40) and 20 writes a minute (burst 20). It answers `429` in the API's error format. A Cloudflare WAF rule also blocks an IP that sends more than 100 `/api/` requests in 10 seconds.
- **Errors from nginx itself** use the API's `{ statusCode, code, message }` format: `429`, and `503` in place of `502`/`504` while the API restarts.
- **Security headers** come from nginx: a same-origin CSP, `nosniff`, frame denial and a referrer policy. nginx sets no HSTS header, because `.dev` is on the browsers' HSTS preload list.
- **Releases:** the images are `ghcr.io/anhntt96/workout-api` and `workout-web`, tagged with the commit SHA. `deploy.sh` switches `IMAGE_TAG`, waits for the health checks, and puts the previous tag back if the release doesn't become healthy. Migrations still run at API startup under the advisory lock, so each migration must work with the previous release's code.
- **Backups:** a daily `pg_dump -Fc` goes to R2 and is kept 14 days. The restore is tested in CI and on the server.

## Consequences

**Positive**
- One Compose file per environment, and CI tests both: the local stack, and a rehearsal of the production file.
- No public origin for HTTP and no certificates to manage.
- A bad release rolls itself back, and any earlier SHA can be redeployed.

**Negative (accepted)**
- One machine: a VPS outage is an outage, and each deploy restarts the API, giving a few seconds of JSON `503`s.
- The database lives on the VPS disk. The worst case loses up to a day of data, back to the last nightly dump.
- The SSH port is open for CI deploys (keys only, fail2ban).
- Public writes are rate-limited, not authenticated, and the demo data may be reset.

## Testing

- `scripts/smoke-test.sh` checks the UI, the proxy, the headers, the error formats and the rate limits, in CI and after every deploy.
- `deploy/test-deploy.sh` rehearses deploys, rollback, and backup and restore with the production Compose file, in CI.

## Revisit If

- Real users or authentication arrive: move to managed Postgres with point-in-time recovery, and authenticate before rate-limiting.
- Uptime starts to matter: run two or more API instances behind a load balancer, with rolling deploys.
- The open SSH port becomes a concern: deploy through Cloudflare Access for SSH, or a pull-based agent.
