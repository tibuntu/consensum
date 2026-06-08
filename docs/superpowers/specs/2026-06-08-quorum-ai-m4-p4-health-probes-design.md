# M4 · P4 — Health & Readiness Probes (design)

> Phase spec for M4 P4. Parent roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`.
> Native container/Kubernetes liveness + readiness probes.

## Problem

There is no health endpoint. Containers and orchestrators can't tell whether the app process is alive or whether it can serve traffic (DB reachable). Dockerfile and `docker-compose.yml` define no healthcheck; no k8s manifests exist. There is no middleware, so new probe routes are reachable unauthenticated without extra work.

## Decisions (locked)

- **Two endpoints**: `/healthz` (liveness) and `/readyz` (readiness). A k8s **startup probe reuses `/readyz`** with a higher `failureThreshold` — no third endpoint.
- **Liveness is dependency-free**: `/healthz` returns 200 if the process responds; it never touches the DB (so a liveness failure means "restart," not "DB down").
- **Readiness checks DB connectivity**: `/readyz` runs a cheap `SELECT 1`; 200 on success, 503 on failure. (Not the outbox worker — a stalled worker shouldn't pull the instance out of the load balancer.)
- Unauthenticated; never cached.

## Endpoints

### `GET /healthz` — liveness
`app/healthz/route.ts`:

```ts
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ status: "ok" });
}
```

Always 200 while the event loop is responsive. No imports beyond the handler.

### `GET /readyz` — readiness
`app/readyz/route.ts`:

```ts
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
```

Both at app root (not under `/api`) to match the `/healthz` / `/readyz` convention. `force-dynamic` guarantees they run per-request (no static prerender of a health result).

## Container / orchestration wiring

`node:24-slim` has no `curl`/`wget`, but Node 24 has global `fetch`. Use a Node one-liner.

### Dockerfile
Add before the start `CMD` (port 3000):

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

### docker-compose.yml
Add under the `app` service:

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      start_period: 20s
      retries: 3
```

### README — document the probes + a k8s snippet (not a maintained manifest)

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 3000 }
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 10
startupProbe:
  httpGet: { path: /readyz, port: 3000 }
  failureThreshold: 30
  periodSeconds: 2
```

## Tests
- `tests/unit/healthz.test.ts`: `GET()` → status 200, body `{status:"ok"}`.
- `tests/unit/readyz.test.ts`: DB up → 200 `{status:"ok"}`; mock `prisma.$queryRaw` to reject → 503 `{status:"unavailable"}`.

## Out of scope
Worker/queue-depth health · per-dependency detailed health JSON · metrics/Prometheus endpoint · authenticated admin health · maintained k8s manifests/Helm chart. → M5+ if needed.

## Files touched
- `app/healthz/route.ts` (new), `app/readyz/route.ts` (new)
- `Dockerfile`, `docker-compose.yml` (healthcheck)
- `README.md` (probe paths + k8s snippet)
- tests: `tests/unit/healthz.test.ts`, `tests/unit/readyz.test.ts`
