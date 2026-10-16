# Deploying to AWS (EC2 + RDS)

PostgreSQL runs on RDS. The API and the web (nginx) containers run on one EC2 instance from `compose.prod.yaml`. The API runs its own migrations at startup, so there is no separate migrate step.

## 1. AWS resources

- **RDS**: PostgreSQL 16–18 in a private subnet, not publicly accessible. Create the database `workout` and an app user (not the master user).
- **Security groups**: the EC2 group allows 80/443 from the internet and 22 only from your IP (or use SSM Session Manager). The RDS group allows 5432 only from the EC2 group.
- **EC2**: Amazon Linux 2023, t3.small or larger, in the same VPC as RDS. Port 3000 stays closed.

## 2. Install Docker on the instance

```sh
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user   # log out and in again
```

Then install the Docker Compose v2 plugin.

## 3. RDS TLS

RDS for PostgreSQL 15+ requires SSL, and Node does not trust the AWS CA by default (the API would fail with `self-signed certificate in certificate chain`). `compose.prod.yaml` mounts the AWS CA bundle and sets `NODE_EXTRA_CA_CERTS`, so the connection string can use `sslmode=verify-full`. For a quick demo only, `sslmode=no-verify` encrypts without verifying the certificate.

## 4. Configure and start

```sh
git clone <repo> && cd workout_api_log
curl -fsSLo global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
cat > .env <<'EOF'
DATABASE_URL=postgres://workout_app:<password>@<rds-endpoint>:5432/workout?sslmode=verify-full
LOG_LEVEL=info
DB_POOL_MAX=10
EOF
chmod 600 .env
docker compose -f compose.prod.yaml up -d --build
```

`DB_POOL_MAX × instances` must stay under the RDS `max_connections`.

## 5. Verify

```sh
docker compose -f compose.prod.yaml logs api   # migrations applied, then listening
curl localhost/api/health
curl localhost/api/exercises
```

Then run `scripts/demo.sh` against `http://<ec2-ip>/api`.

## HTTPS and the domain

`compose.prod.yaml` runs Caddy in front of nginx. Caddy gets and renews a Let's Encrypt certificate for the host in `Caddyfile` (`workout.albertnguyen.dev`), redirects HTTP to HTTPS, and proxies to the `web` container. Change the hostname in `Caddyfile` for another domain.

- DNS: an `A` record for the host pointing at the instance's (Elastic) IP. With the Cloudflare proxy on (orange cloud), set SSL/TLS mode to **Full (strict)**; Caddy's certificate is valid, so strict works. A `521` error means Cloudflare cannot reach port 443 on the instance.
- Security group: inbound 80 (certificate challenge and redirect) and 443.
- Certificates live in the `caddy-data` volume, so restarts do not re-issue them.

## Hardening

- An Elastic IP so the address survives restarts.
- RDS automated backups (on by default) and Multi-AZ if availability matters.
- Keep the database password in SSM Parameter Store or Secrets Manager instead of `.env`.
