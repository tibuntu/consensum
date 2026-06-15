# Upgrading

## v0.3.0 → v0.4.0 — renamed from "Quorum AI" to **Consensum**

The product was renamed from **Quorum AI** to **Consensum**. This is a breaking
change with no backward-compatible aliases. If you are self-hosting, perform the
following before upgrading.

### 1. Agent environment variables (renamed)

The machine-API env vars used by the `/push-plan` and `/pull-feedback` commands
were renamed. Update your agent environment and any CI configuration:

| Old | New |
|---|---|
| `QUORUM_BASE_URL` | `CONSENSUM_BASE_URL` |
| `QUORUM_API_TOKEN` | `CONSENSUM_API_TOKEN` |

> Server-side env vars (`AUTH_SECRET`, `BASE_URL`, `DATABASE_URL`, `OIDC_*`,
> `WEBHOOK_SECRET_KEY`, `EMAIL_*`) are unchanged.

### 2. Re-issue API tokens (required)

API tokens now use the `csm_` prefix instead of `qai_`. Existing `qai_…` tokens
are no longer issued; generate fresh tokens under **Settings → API tokens** and
update your agent configuration.

### 3. Webhook consumers (header rename)

Outbound webhook headers were renamed. Update any receiver that reads them:

| Old | New |
|---|---|
| `X-Quorum-Event` | `X-Consensum-Event` |
| `X-Quorum-Timestamp` | `X-Consensum-Timestamp` |
| `X-Quorum-Signature` | `X-Consensum-Signature` |

If you set `WEBHOOK_SECRET_KEY`, note that the at-rest key-derivation salt also
changed, so **existing encrypted webhook signing secrets cannot be decrypted**.
Re-create your webhooks (Settings → Webhooks) to mint new signing secrets.

### 4. Docker volume (rename to keep your data)

The Compose volume was renamed `quorum-data` → `consensum-data`. If you bring up
the new Compose file as-is, Docker creates a fresh empty `consensum-data` volume
and your existing database is left behind in the old `quorum-data` volume.

To preserve your data, either keep the old volume name in your override, or
migrate the volume before starting, e.g.:

```bash
docker volume create consensum-data
docker run --rm -v quorum-data:/from -v consensum-data:/to alpine \
  sh -c "cp -a /from/. /to/"
```

Then start Consensum normally.
