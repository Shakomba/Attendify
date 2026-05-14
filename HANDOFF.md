# Attendify — Handoff Document
_Last updated: 2026-05-03_

---

## Live Infrastructure

| Item | Value |
|------|-------|
| **Droplet** | `attendify-gpu` — DigitalOcean Toronto 1 (`tor1`) |
| **IP** | `165.22.233.111` |
| **GPU** | NVIDIA RTX 6000 Ada (48 GB VRAM) |
| **Specs** | 8 vCPUs, 64 GB RAM, 500 GB NVMe |
| **Cost** | $1.57/hr (~$1,168/mo) |
| **DO Droplet ID** | `568609350` |
| **SSH key** | `~/.ssh/attendify_prod` (`attendify-prod-deploy`) |
| **SSH** | `ssh -i ~/.ssh/attendify_prod root@165.22.233.111` |

### URLs
| Service | URL |
|---------|-----|
| Frontend | https://attendify.tech |
| API | https://api.attendify.tech |
| API Docs | https://api.attendify.tech/docs |

### DNS (Cloudflare — DNS only, grey cloud)
```
A  attendify.tech      → 165.22.233.111
A  api.attendify.tech  → 165.22.233.111
```

---

## Running Containers

| Container | Image | Role |
|-----------|-------|------|
| `ams_sqlserver` | `mcr.microsoft.com/mssql/server:2022-latest` | SQL Server 2022 |
| `ams_backend` | `ams_backend_gpu:latest` | FastAPI + InsightFace GPU |
| `ams_frontend` | `attendify-frontend` | React app (Vite → nginx) |
| `ams_nginx` | `nginx:1.27-alpine` | Reverse proxy + SSL termination |

All containers are in `/opt/attendify` on the droplet. SSL certs are in the `certbot` Docker volume (valid, not near expiry).

---

## Deployment

### Standard deploy (after any code change)
```bash
# 1. Push local commits
git push origin main

# 2. Pull and rebuild on server
ssh -i ~/.ssh/attendify_prod root@165.22.233.111
cd /opt/attendify
git pull origin main
docker compose up -d --build frontend   # frontend only — fast
# or
docker compose up -d --build            # full rebuild — slow, only if backend changed
```

### Deploy script (local rsync alternative)
```bash
# From project root — syncs local files without going through GitHub
./deploy.sh 165.22.233.111
```

### SSL renewal
```bash
ssh -i ~/.ssh/attendify_prod root@165.22.233.111
cd /opt/attendify
docker compose run --rm certbot renew && docker compose restart nginx
```

Cron suggestion (add on server):
```
0 3 * * * cd /opt/attendify && docker compose run --rm certbot renew && docker compose restart nginx
```

---

## Repository

| Item | Value |
|------|-------|
| **GitHub** | https://github.com/Shakomba/Attendify.git |
| **Branch** | `main` |
| **Local path** | `d:\Attendify` |

### Key directories
```
backend/app/
  main.py          — FastAPI routes
  auth.py          — JWT helpers (professor + student tokens)
  repos.py         — All DB queries
  schemas.py       — Pydantic models
  config.py        — Settings (env vars)
  services/
    email_service.py — Resend/SMTP invite emails

frontend/src/
  App.jsx                          — Root: routing, auth state, role-based views
  hooks/
    useApi.js                      — apiFetch (token injection, error handling)
    useSession.js                  — Live session state
  components/
    enrollment/EnrollmentTab.jsx   — Student list + Add Student modal
    student/StudentPortal.jsx      — Student-facing portal
    student/PasswordSetup.jsx      — First-time password via invite link

database/
  01_init_schema.sql               — Full schema + seed data
  02_student_portal_migration.sql  — Student portal columns + StudentInviteTokens table
```

---

## Database

**SQL Server 2022** — database: `AttendanceAI`

The migration `02_student_portal_migration.sql` has already been applied on the live server. It adds:
- `Students.FullNameKurdish`
- `Students.PasswordHash`
- `Students.FaceDeletedBySelf`
- `Students.FaceDeletedAt`
- New table: `StudentInviteTokens`

To run a migration manually:
```bash
cd /opt/attendify
SA_PASS="$(grep MSSQL_SA_PASSWORD .env | cut -d= -f2)"
docker compose exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$SA_PASS" -C -d AttendanceAI \
  < /opt/attendify/database/<migration_file>.sql
```

---

## Environment (.env on server)

File location: `/opt/attendify/.env` — **never committed to git**.

Required keys:
```
MSSQL_SA_PASSWORD=
JWT_SECRET_KEY=
SMTP_USER=
SMTP_PASSWORD=
RESEND_API_KEY=          # optional, if using Resend instead of SMTP
FRONTEND_URL=https://attendify.tech
AI_MODE=gpu
```

To inspect (without exposing values):
```bash
grep -v '=' /opt/attendify/.env   # shows key names only
```

---

## What Was Done This Session (2026-05-02/03)

1. **Created new GPU droplet** (`attendify-gpu`, ID `568609350`) in Toronto from snapshot `attendify-gpu-tor1-1777065009745`.
2. **Switched repo** from `Attendance-Management-System` to `Attendify` on the server (cloned fresh, `.env` preserved).
3. **Ran SQL migration** `02_student_portal_migration.sql` (student portal columns + invite tokens table).
4. **Fixed SSL** — certs were already in the certbot Docker volume from the snapshot; restarted nginx to pick them up.
5. **Fixed missing features** — local branch was 23 commits ahead of GitHub; pushed all commits and rebuilt.
6. **Fixed auth bug** — `useApi.js` was spreading `...fetchOptions` after `headers`, clobbering the `Authorization` header on any request that passed explicit headers (POST, PATCH, DELETE). GET requests were unaffected. Fix: destructure `headers` out of `fetchOptions` before spreading.
7. **Fixed error display** — FastAPI Pydantic validation errors return `detail` as an array of objects; the frontend was rendering `[object Object]`. Fix: stringify array details via `detail.map(e => e.msg).join(', ')`.

---

## Known State / Watch Out For

- **Backend image** (`ams_backend_gpu:latest`) was NOT rebuilt this session — it uses the image baked into the snapshot. If backend code changes, run `docker compose up -d --build backend` (takes ~10–15 min due to CUDA layers).
- **Email sending** — check `SMTP_DRY_RUN` in `.env`. If `true`, invite emails are suppressed (logged only). Set to `false` for real sending.
- **`api.shakomba.org`** is referenced in `frontend/.env.production` as `VITE_API_BASE_URL`. Ensure this domain resolves to `165.22.233.111` or update the env var and rebuild frontend.
- **Snapshot** (`attendify-gpu-tor1-1777065009745`, ID `225961569`) is still in DigitalOcean — keep it as a restore point or delete to save storage costs.
- **JWT expiry** is 480 minutes (8 hours) — professors and students are logged out after 8 hours of inactivity.
