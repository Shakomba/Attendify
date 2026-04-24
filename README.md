<div align="center">

# Attendify (Attendance Management System)

A state-of-the-art, AI-powered system for automated classroom attendance. Utilizing high-speed facial recognition and military-grade spoof detection to eliminate manual roll calls and ensure academic integrity.

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![SQL Server](https://img.shields.io/badge/SQL_Server-CC292B?style=for-the-badge&logo=microsoft-sql-server&logoColor=white)](https://www.microsoft.com/en-us/sql-server)

</div>

<br />

## Key Features

- **Blazing Fast AI Face Recognition**: Automatically detects and matches students against their 5-angle biometric profiles in real-time. Supports CPU inference (via `dlib`/`face_recognition`) or GPU inference (via `InsightFace`).
- **Passive Liveness Anti-Spoofing**: Defeats replay attacks, photos, and deepfakes using a temporal `MiniFASNet` ONNX ensemble.
- **Comprehensive Dashboard & Gradebook**: Real-time tracking of lectures, auto-calculated absence tallies, gradebook integration, and identifying at-risk students.
- **Automated Reporting**: Bulk dispatch HTML absence warnings and grade reports directly to students with predefined thresholds.
- **Full RTL & Multi-Language Support**: Fully localized in English and Central Kurdish (Sorani).
- **Passkey Biometric Login**: Professors can log in securely via WebAuthn, no password required.

---

## Architecture Stack

### Backend (`/backend`)
- **Framework**: `FastAPI` + `uvicorn` (Python 3.11)
- **Database**: `SQL Server 2022` with stored procedures via `pyodbc`
- **Biometrics (GPU Mode)**: `InsightFace` (detection & embeddings) + `ONNXRuntime-GPU`
- **Biometrics (CPU Mode)**: `dlib` & `face_recognition`
- **Anti-Spoofing**: Temporal Sliding-Window `MiniFASNetV1SE` and `MiniFASNetV2`

### Frontend (`/frontend`)
- **Framework**: `React 18` + `Vite`
- **Styling**: `Tailwind CSS` with CSS Variables for Dark/Light theme switching
- **State Management**: React Hooks + Custom APIs for WebSockets (`/ws/dashboard/` & `/ws/camera/`)
- **Localization**: Custom lightweight `i18n` with automatic document direction formatting.

---

## Repository Structure

```text
├── backend/                  # FastAPI app (app/), requirements, local runner
├── frontend/                 # React + Vite SPA
├── database/                 # SQL Server schema + stored procedures
├── docker/                   # Dockerfiles (backend-base, backend-gpu)
├── nginx/                    # nginx.conf (prod), local.conf (local dev)
├── scripts/                  # Utilities (e.g., ONNX model generator)
├── docker-compose.yml        # Production stack (GPU backend + SQL + nginx + certbot)
├── docker-compose.local.yml  # Local dev overrides (CPU backend, no SSL)
├── deploy.sh                 # Sync + build + start on a VPS using Docker
└── ssl-init.sh               # One-time Let's Encrypt cert setup
```

---

## Local Development

### Prerequisites
- Node.js & npm (v18+)
- Python 3.11
- SQL Server (Local or Docker)

### 1. Database Setup
```bash
sqlcmd -S localhost,1433 -U sa -P <your-password> -i database/01_init_schema.sql
```

### 2. Backend & API
```bash
cd backend
python -m venv .venv311
source .venv311/bin/activate        # On Windows: .venv311\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # Edit the DB/SMTP variables inside
./run_backend_311.sh                # Starts uvicorn gracefully on port 8000
```

### 3. Frontend Application
```bash
cd frontend
npm install
npm run dev                         # Serves app on http://localhost:5173
```

*(Alternatively, for local Docker deployment, run: `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build`)*

---

## Production Deployment (VPS)

Attendify is tailored for deployment on isolated GPU droplets (e.g., DigitalOcean RTX 6000 Ada).

### 1. VPS Host Prep (Run Once)
Install standard Docker utilities & the NVIDIA Container Toolkit on your VPS.

```bash
apt-get install -y docker.io docker-compose-plugin
# See deploy.sh header for detailed nvidia-toolkit commands
```

### 2. Push & Deploy via Script
The `deploy.sh` script automates `rsync` file transfers and restarts the remote `docker compose` instance.

```bash
./deploy.sh <droplet-ip>
```
*Note: Make sure to manually populate `/opt/attendify/.env` on the VPS with your secrets (`JWT_SECRET_KEY`, `MSSQL_SA_PASSWORD`, `SMTP_PASSWORD`) before deploying!*

### 3. SSL Generation
```bash
ssh root@<ip> "cd /opt/attendify && bash ssl-init.sh you@example.com"
```

The production services will then bind to your DNS records:
- **Application**: [https://attendify.tech](https://attendify.tech)
- **API Backend**: [https://api.attendify.tech](https://api.attendify.tech)
- **Interactive Swagger Docs**: [https://api.attendify.tech/docs](https://api.attendify.tech/docs)
