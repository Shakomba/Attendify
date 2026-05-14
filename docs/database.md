# AttendanceAI — Database Documentation

**Engine:** SQL Server 2022  
**Database name:** `AttendanceAI`  
**Schema:** `dbo`  
**Collation:** server default (SQL_Latin1_General_CP1_CI_AS)

---

## Table of Contents

1. [Overview](#overview)
2. [Entity Relationship Summary](#entity-relationship-summary)
3. [Tables](#tables)
   - [Students](#students)
   - [Courses](#courses)
   - [Professors](#professors)
   - [Enrollments](#enrollments)
   - [StudentFaceEmbeddings](#studentfaceembeddings)
   - [StudentInviteTokens](#studentinvitetokens)
   - [ClassSessions](#classsessions)
   - [SessionRecognitions](#sessionrecognitions)
   - [SessionAttendance](#sessionattendance)
   - [SessionHourLog](#sessionhourlog)
   - [EmailDispatchLog](#emaildispatchlog)
   - [WebAuthnCredentials](#webauthnCredentials)
4. [Views](#views)
   - [vw_Gradebook](#vw_gradebook)
5. [Stored Procedures](#stored-procedures)
   - [sp_StartSession](#sp_startsession)
   - [sp_UpsertAttendanceOnRecognition](#sp_upsertattendanceonrecognition)
   - [sp_FinalizeSession](#sp_finalizesession)
6. [Indexes](#indexes)
7. [Grade Formula Reference](#grade-formula-reference)
8. [Seed Data](#seed-data)
9. [Migrations](#migrations)

---

## Overview

The database stores all data for an AI-powered attendance management system. The core flow is:

1. A **Professor** starts a **ClassSession** for their **Course**.
2. A camera feeds frames to the backend; recognized faces generate **SessionRecognitions** and update **SessionAttendance** in real time.
3. When the session is finalized, **sp_FinalizeSession** tallies absent hours and writes them back to **Enrollments**.
4. Students receive invite emails via magic links; they log in through the **StudentPortal** using bcrypt-hashed passwords.

---

## Entity Relationship Summary

```
Courses ──< Professors
Courses ──< Enrollments >── Students
Courses ──< ClassSessions ──< SessionRecognitions >── Students
                           ──< SessionAttendance   >── Students
                           ──< SessionHourLog      >── Students
                           ──< EmailDispatchLog    >── Students
Students ──< StudentFaceEmbeddings
Students ──< StudentInviteTokens
Professors ──< WebAuthnCredentials
```

---

## Tables

### Students

Stores university students. One row per student; a student may be enrolled in multiple courses via **Enrollments**.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `StudentID` | `INT IDENTITY(1,1)` | No | — | Primary key |
| `StudentCode` | `NVARCHAR(30)` | No | — | Unique institutional code (e.g. `S001`) |
| `FullName` | `NVARCHAR(120)` | No | — | Latin-script name |
| `FullNameKurdish` | `NVARCHAR(120)` | Yes | `NULL` | Kurdish-script name, added in migration 02 |
| `Email` | `NVARCHAR(255)` | No | — | Unique; used as login username for student portal |
| `ProfilePhotoUrl` | `NVARCHAR(500)` | Yes | `NULL` | Not currently used by the app |
| `IsActive` | `BIT` | No | `1` | Soft-delete flag; inactive students are excluded from queries |
| `EnrollmentStatus` | `NVARCHAR(20)` | No | `'pending'` | Not actively used post-enrollment |
| `PasswordHash` | `NVARCHAR(255)` | Yes | `NULL` | bcrypt hash; `NULL` until the student accepts their invite |
| `FaceDeletedBySelf` | `BIT` | No | `0` | Set to `1` when a student deletes their own Face ID |
| `FaceDeletedAt` | `DATETIME2(0)` | Yes | `NULL` | Timestamp of self-deletion |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | Row creation time (UTC) |

**Constraints:** `UNIQUE (StudentCode)`, `UNIQUE (Email)`

---

### Courses

One row per course. Each professor is assigned to exactly one course.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `CourseID` | `INT IDENTITY(1,1)` | No | — | Primary key |
| `CourseCode` | `NVARCHAR(30)` | No | — | Unique code (e.g. `CS201`) |
| `CourseName` | `NVARCHAR(120)` | No | — | Display name |
| `ScheduledStartTime` | `TIME(0)` | No | `'08:00:00'` | Official start time; used by sp_UpsertAttendanceOnRecognition |
| `LateGraceMinutes` | `INT` | No | `10` | Minutes after each hour boundary a student is still considered on time |
| `MaxAllowedAbsentHours` | `INT` | No | `8` | Policy threshold; used in `vw_Gradebook.AtRiskByPolicy` |
| `IsActive` | `BIT` | No | `1` | Soft-delete flag |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |

**Constraints:** `UNIQUE (CourseCode)`

---

### Professors

System accounts for instructors. Each professor manages exactly one course.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `ProfessorID` | `INT IDENTITY(1,1)` | No | — | Primary key |
| `Username` | `NVARCHAR(50)` | No | — | Unique login handle |
| `PasswordHash` | `NVARCHAR(128)` | No | — | bcrypt hash (rounds=12); legacy SHA-256 hashes (64-char hex) are rejected at login |
| `FullName` | `NVARCHAR(120)` | No | — | Display name |
| `CourseID` | `INT` | No | — | FK → `Courses.CourseID` |
| `IsActive` | `BIT` | No | `1` | Soft-delete flag |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |

**Foreign keys:** `CourseID` → `Courses(CourseID)`

---

### Enrollments

Junction table linking students to courses, plus all grade and absence data for that pairing. Contains four computed persisted columns that drive grading logic.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `EnrollmentID` | `INT IDENTITY(1,1)` | No | — | Primary key |
| `StudentID` | `INT` | No | — | FK → `Students.StudentID` |
| `CourseID` | `INT` | No | — | FK → `Courses.CourseID` |
| `Quiz1` | `DECIMAL(5,2)` | No | `0` | Max 100 |
| `Quiz2` | `DECIMAL(5,2)` | No | `0` | Max 100 |
| `ProjectGrade` | `DECIMAL(5,2)` | No | `0` | Max 100 |
| `AssignmentGrade` | `DECIMAL(5,2)` | No | `0` | Max 100 |
| `MidtermGrade` | `DECIMAL(5,2)` | No | `0` | Max 100 |
| `FinalExamGrade` | `DECIMAL(5,2)` | No | `0` | Max 100 |
| `HoursAbsentTotal` | `DECIMAL(8,2)` | No | `0` | Cumulative absent hours; incremented by `sp_FinalizeSession` |
| `AttendancePenalty` | `DECIMAL(8,2)` | — | **Computed, persisted** | `MIN(HoursAbsentTotal, 5)` — capped at 5 points |
| `RawTotal` | `DECIMAL(8,2)` | — | **Computed, persisted** | Sum of all six grade components |
| `AdjustedTotal` | `DECIMAL(8,2)` | — | **Computed, persisted** | `MAX(RawTotal − AttendancePenalty, 0)` |
| `AtRisk` | `BIT` | — | **Computed, persisted** | `1` if `AdjustedTotal < 60` OR `HoursAbsentTotal >= 4` |
| `UpdatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | Last write time |

**Constraints:** `UNIQUE (StudentID, CourseID)`  
**Foreign keys:** `StudentID` → `Students`, `CourseID` → `Courses`  
**Indexes:** `IX_Enrollments_CourseID (CourseID)`

---

### StudentFaceEmbeddings

Stores biometric face vectors used for real-time recognition. Supports multi-angle enrollment (up to one embedding per student/model/pose combination).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `EmbeddingID` | `BIGINT IDENTITY(1,1)` | No | — | Primary key |
| `StudentID` | `INT` | No | — | FK → `Students.StudentID` |
| `ModelName` | `NVARCHAR(40)` | No | — | Model that produced the vector (e.g. `insightface-512`, `hog-128`) |
| `EmbeddingData` | `VARBINARY(MAX)` | No | — | Raw float32 bytes of the face embedding |
| `IsPrimary` | `BIT` | No | `1` | Only one primary embedding per (StudentID, ModelName, PoseLabel) |
| `PoseLabel` | `NVARCHAR(30)` | No | `'front'` | One of: `front`, `left`, `right`, `up`, `down` |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |

**Foreign keys:** `StudentID` → `Students`  
**Unique index:** `UX_Embeddings_Primary ON (StudentID, ModelName, PoseLabel) WHERE IsPrimary = 1`  
Ensures only one active embedding per pose per model per student; enforces upsert semantics.

---

### StudentInviteTokens

One-time magic-link tokens sent to students when they are first added, or when a professor resends the invite.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `TokenID` | `UNIQUEIDENTIFIER` | No | `NEWID()` | Primary key |
| `StudentID` | `INT` | No | — | FK → `Students.StudentID` |
| `Token` | `NVARCHAR(128)` | No | — | URL-safe random token (secrets.token_urlsafe(32)); unique |
| `ExpiresAt` | `DATETIME2(0)` | No | — | 48 hours after creation |
| `UsedAt` | `DATETIME2(0)` | Yes | `NULL` | Set when validated; all prior tokens for a student are also marked used |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |

**Foreign keys:** `StudentID` → `Students`  
**Constraints:** `UNIQUE (Token)`

**Flow:** When a token is validated at `GET /api/auth/invite`, all tokens for that student are immediately marked used (`UsedAt = now`), preventing replay.

---

### ClassSessions

One row per lecture/class session. A session moves from `active` to `finalized` when the professor ends it.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `SessionID` | `UNIQUEIDENTIFIER` | No | `NEWSEQUENTIALID()` | Primary key; sequential UUIDs improve index performance |
| `CourseID` | `INT` | No | — | FK → `Courses.CourseID` |
| `StartedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | Session start time (UTC) |
| `EndedAt` | `DATETIME2(0)` | Yes | `NULL` | Set by `sp_FinalizeSession`; `NULL` while active |
| `Status` | `NVARCHAR(20)` | No | `'active'` | `active` or `finalized` |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |

**Constraints:** `CHECK (Status IN ('active', 'finalized'))`  
**Foreign keys:** `CourseID` → `Courses`

---

### SessionRecognitions

Raw log of every recognition event fired by the AI engine during a session. Used for audit and debugging; not directly used for grading.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `RecognitionID` | `BIGINT IDENTITY(1,1)` | No | — | Primary key |
| `SessionID` | `UNIQUEIDENTIFIER` | No | — | FK → `ClassSessions.SessionID` |
| `StudentID` | `INT` | Yes | — | `NULL` for unknown/unrecognized faces |
| `RecognizedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |
| `Confidence` | `DECIMAL(6,4)` | Yes | — | Cosine similarity score (0–1) |
| `EngineMode` | `NVARCHAR(12)` | No | — | `cpu` or `gpu` |
| `Notes` | `NVARCHAR(200)` | Yes | — | Supplemental info (e.g. spoof flag) |

**Foreign keys:** `SessionID` → `ClassSessions`, `StudentID` → `Students`  
**Index:** `IX_SessionRecognitions_SessionTime ON (SessionID, RecognizedAt DESC)`

---

### SessionAttendance

One row per (session, student) pair. This is the authoritative attendance record. Written by `sp_UpsertAttendanceOnRecognition` during the session and finalized by `sp_FinalizeSession`.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `SessionID` | `UNIQUEIDENTIFIER` | No | — | Composite PK (part 1) |
| `StudentID` | `INT` | No | — | Composite PK (part 2) |
| `FirstSeenAt` | `DATETIME2(0)` | Yes | `NULL` | First recognition within a grace window; `NULL` if never seen on time |
| `LastSeenAt` | `DATETIME2(0)` | Yes | `NULL` | Most recent recognition regardless of grace |
| `IsPresent` | `BIT` | No | `0` | `1` if the student was marked present for at least one grace window |
| `IsLate` | `BIT` | No | `0` | `1` if first seen after the grace window of the first hour |
| `ArrivalDelayMinutes` | `INT` | Yes | — | Minutes late on first recognized arrival |
| `ManualOverride` | `BIT` | — | — | Set by professor via the attendance PATCH endpoint (not in schema DDL; added by application upsert) |

**Primary key:** `(SessionID, StudentID)`  
**Foreign keys:** `SessionID` → `ClassSessions`, `StudentID` → `Students`  
**Index:** `IX_SessionAttendance_Session ON (SessionID, IsPresent)`

> **Note on ManualOverride:** This flag is set in `repos.py` via a MERGE statement rather than the DDL; it exists on the live DB but is absent from `01_init_schema.sql`.

---

### SessionHourLog

Granular hour-by-hour presence log. One row per (session, student, hour index). Used by `sp_FinalizeSession` to calculate partial absence weights.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `SessionID` | `UNIQUEIDENTIFIER` | No | — | Composite PK (part 1) |
| `StudentID` | `INT` | No | — | Composite PK (part 2) |
| `HourIndex` | `INT` | No | — | Composite PK (part 3); 0-based hour offset from session start |
| `HourStart` | `DATETIME2(0)` | No | — | `StartedAt + HourIndex hours` |
| `IsPresent` | `BIT` | No | `0` | `1` if recognized within the grace window of this hour |
| `Source` | `NVARCHAR(20)` | No | `'system'` | `'recognizer'` if set by AI; `'system'` if filled in by finalization |

**Primary key:** `(SessionID, StudentID, HourIndex)`  
**Foreign keys:** `SessionID` → `ClassSessions`, `StudentID` → `Students`  
**Index:** `IX_SessionHourLog_Session ON (SessionID, HourIndex)`

---

### EmailDispatchLog

Audit trail of every absence/grade email sent by the system.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `EmailLogID` | `BIGINT IDENTITY(1,1)` | No | — | Primary key |
| `SessionID` | `UNIQUEIDENTIFIER` | No | — | FK → `ClassSessions.SessionID` |
| `StudentID` | `INT` | No | — | FK → `Students.StudentID` |
| `RecipientEmail` | `NVARCHAR(255)` | No | — | Address the email was sent to |
| `SubjectLine` | `NVARCHAR(200)` | No | — | Email subject |
| `SentAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |
| `Status` | `NVARCHAR(20)` | No | — | `sent` or `failed` |
| `ErrorMessage` | `NVARCHAR(MAX)` | Yes | — | Populated on failure |

**Foreign keys:** `SessionID` → `ClassSessions`, `StudentID` → `Students`

---

### WebAuthnCredentials

Passkey (FIDO2) credentials registered by professors. Created dynamically on first app startup via `repo.ensure_webauthn_table()` — not in the static DDL files.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `CredentialID` | `NVARCHAR(512)` | No | — | Primary key; base64url-encoded FIDO2 credential ID |
| `ProfessorID` | `INT` | No | — | Owning professor (not FK-constrained in DDL) |
| `PublicKey` | `VARBINARY(MAX)` | No | — | COSE-encoded public key bytes |
| `SignCount` | `INT` | No | `0` | Monotonically increasing counter; checked on each authentication to detect cloned authenticators |
| `DeviceName` | `NVARCHAR(100)` | Yes | — | Human-readable label set at registration (e.g. "MacBook Touch ID") |
| `CreatedAt` | `DATETIME2(0)` | No | `SYSUTCDATETIME()` | UTC |

---

## Views

### vw_Gradebook

Read-only view joining `Enrollments`, `Students`, and `Courses`. Used by `GET /api/courses/{course_id}/gradebook`.

**Selected columns:**

| Column | Source | Notes |
|--------|--------|-------|
| `CourseID`, `CourseCode`, `CourseName` | `Courses` | |
| `StudentID`, `StudentCode`, `FullName`, `Email` | `Students` | |
| `Quiz1` … `FinalExamGrade` | `Enrollments` | Raw grade components |
| `HoursAbsentTotal`, `AttendancePenalty` | `Enrollments` | Computed |
| `RawTotal`, `AdjustedTotal`, `AtRisk` | `Enrollments` | Computed, persisted |
| `AtRiskByPolicy` | Computed in view | `1` if `AdjustedTotal < 60` OR `HoursAbsentTotal >= MaxAllowedAbsentHours` — uses the course-level threshold rather than the hardcoded 4-hour threshold in `AtRisk` |
| `UpdatedAt` | `Enrollments` | |

---

## Stored Procedures

### sp_StartSession

Creates a new `ClassSession` row.

```sql
EXEC dbo.sp_StartSession
    @CourseID  = 1,
    @StartedAt = NULL,    -- defaults to SYSUTCDATETIME()
    @SessionID = @out OUTPUT
```

Called by the Python layer rather than used directly; `@StartedAt` can be passed explicitly to backdate a session.

---

### sp_UpsertAttendanceOnRecognition

Called for each face recognition event. Maintains both `SessionAttendance` (per-session summary) and `SessionHourLog` (per-hour detail) using MERGE statements.

```sql
EXEC dbo.sp_UpsertAttendanceOnRecognition
    @SessionID    = '...',
    @StudentID    = 42,
    @RecognizedAt = '2026-05-14 09:07:00'
```

**Logic:**
1. Calculates `DelayMinutes` from session start.
2. Computes `HourIndex = DelayMinutes / 60` and `MinutesIntoHour`.
3. `WithinGrace = 1` if `MinutesIntoHour <= LateGraceMinutes`.
4. MERGEs `SessionAttendance`: sets `IsPresent = 1` if `WithinGrace`; once present, never reverted.
5. MERGEs `SessionHourLog`: marks the corresponding hour slot present if `WithinGrace`.

---

### sp_FinalizeSession

Closes an active session and accumulates absent hours into `Enrollments.HoursAbsentTotal`. Idempotent — calling it twice on the same session is a no-op.

```sql
EXEC dbo.sp_FinalizeSession @SessionID = '...'
```

**Steps:**
1. Sets `ClassSessions.EndedAt = now`, `Status = 'finalized'`.
2. Computes `TotalHours = CEILING(DurationMinutes / 60.0)`, minimum 1.
3. Inserts absent `SessionAttendance` rows for students not seen at all.
4. Fills missing `SessionHourLog` slots with `Source = 'system'`, `IsPresent = 0`.
5. Computes per-student absent weight for each hour:
   - `1.0` — never arrived
   - `0.5` — arrived within grace window (late)
   - `0.0` — arrived before this hour started (already present)
6. Adds the summed weight to `Enrollments.HoursAbsentTotal`.

---

## Indexes

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| `UX_Embeddings_Primary` | `StudentFaceEmbeddings` | `(StudentID, ModelName, PoseLabel)` WHERE `IsPrimary = 1` | Unique filtered | One embedding per pose per model |
| `IX_SessionRecognitions_SessionTime` | `SessionRecognitions` | `(SessionID, RecognizedAt DESC)` | Non-unique | Fast lookup of recent recognitions per session |
| `IX_Enrollments_CourseID` | `Enrollments` | `(CourseID)` | Non-unique | Gradebook queries by course |
| `IX_SessionAttendance_Session` | `SessionAttendance` | `(SessionID, IsPresent)` | Non-unique | Presence filtering per session |
| `IX_SessionHourLog_Session` | `SessionHourLog` | `(SessionID, HourIndex)` | Non-unique | Hour-by-hour lookups during finalization |

---

## Grade Formula Reference

All computed columns are `PERSISTED` — SQL Server stores and updates them on each write to `Enrollments`.

```
AttendancePenalty = MIN(HoursAbsentTotal, 5.0)

RawTotal          = Quiz1 + Quiz2 + ProjectGrade
                  + AssignmentGrade + MidtermGrade + FinalExamGrade

AdjustedTotal     = MAX(RawTotal − AttendancePenalty, 0)

AtRisk (column)   = 1  if AdjustedTotal < 60  OR  HoursAbsentTotal >= 4

AtRiskByPolicy    = 1  if AdjustedTotal < 60  OR  HoursAbsentTotal >= MaxAllowedAbsentHours
(view column)          (uses course-level threshold, default 4)
```

The difference between `AtRisk` and `AtRiskByPolicy`:

- `AtRisk` is hardcoded at 4 hours and lives on the `Enrollments` table (no course configuration).
- `AtRiskByPolicy` is in `vw_Gradebook` and reads `Courses.MaxAllowedAbsentHours`, which defaults to 8 but can be set per course.

---

## Seed Data

`01_init_schema.sql` inserts:

- **5 courses** — CS201 through CS205 (Database Systems, Data Structure and Algorithms, Computer Networks, Engineering Analysis, Software Requirement and Analysis). All start between 09:00 and 16:00, 10-minute grace period, 4-hour max absence.
- **6 professors** — one per course (CS201 has two: mr.halgurd and dr.ahmed). Passwords are bcrypt-hashed with rounds=12. Plaintext passwords are listed as SQL comments in the file.
- **5 students** — S001–S005 with `@uor.edu.krd` email addresses.
- **25 enrollment rows** — all 5 students in all 5 courses with pre-seeded grade values and partial absence totals.

---

## Professor Activity Audit

### How attribution works

SQL Server triggers fire at the database layer with no HTTP context. To attribute actions to a professor, the Python layer stamps each connection with the professor ID via SQL Server's session context immediately after opening it:

```sql
EXEC sys.sp_set_session_context N'professor_id', <id>;
```

This is set in `database.py` using a `contextvars.ContextVar` populated by the `get_current_professor` FastAPI dependency in `auth.py`. Every database connection opened during a professor-authenticated request carries the ID; connections opened by AI recognition workers, stored procedures, or migrations carry nothing (value is `NULL`), so those writes are silently ignored by every trigger.

### ProfessorActivityLog

Append-only audit table. Never updated or deleted.

| Column | Type | Notes |
|--------|------|-------|
| `LogID` | `BIGINT IDENTITY` | Primary key |
| `ProfessorID` | `INT NULL` | FK to `Professors`; `NULL` means system/AI write |
| `Action` | `NVARCHAR(60)` | See action values below |
| `TargetTable` | `NVARCHAR(60)` | Table that was modified |
| `TargetID` | `NVARCHAR(200)` | Stringified PK of the affected row |
| `Detail` | `NVARCHAR(MAX)` | Human-readable summary of what changed |
| `OccurredAt` | `DATETIME2(0)` | UTC timestamp |

**Indexes:** `(ProfessorID, OccurredAt DESC)`, `(OccurredAt DESC)`

### vw_ProfessorActivity

Convenience view joining `ProfessorActivityLog` to `Professors` for readable names. Use this for all queries.

```sql
SELECT * FROM dbo.vw_ProfessorActivity ORDER BY OccurredAt DESC;
```

### Action values

| Action | Trigger source | Detail contains |
|--------|----------------|-----------------|
| `session_start` | `ClassSessions INSERT` | `CourseID=…` |
| `session_finalize` | `ClassSessions UPDATE` (active→finalized) | `CourseID=…, Duration=…min` |
| `grade_update` | `Enrollments UPDATE` | Only the fields that changed, e.g. `Midterm: 18.00 → 22.50;` |
| `attendance_override` | `SessionAttendance INSERT/UPDATE` (professor connection only) | `marked_present` or `marked_absent` |
| `student_created` | `Students INSERT` | `Name=…, Email=…` |
| `face_uploaded` | `StudentFaceEmbeddings INSERT` | `Pose=front, Model=insightface-512` |
| `face_deleted` | `StudentFaceEmbeddings DELETE` | `Pose=…, Model=…` |
| `profile_updated` | `Professors UPDATE` | Which fields changed |

### Useful queries

```sql
-- Everything a professor did, newest first
SELECT * FROM dbo.vw_ProfessorActivity
WHERE Username = 'mr.halgurd'
ORDER BY OccurredAt DESC;

-- All grade changes in the last 7 days
SELECT * FROM dbo.vw_ProfessorActivity
WHERE Action = 'grade_update'
  AND OccurredAt >= DATEADD(DAY, -7, SYSUTCDATETIME())
ORDER BY OccurredAt DESC;

-- Full timeline for a specific session
SELECT * FROM dbo.vw_ProfessorActivity
WHERE TargetID LIKE '%<session-uuid>%'
ORDER BY OccurredAt;

-- Action breakdown per professor
SELECT Username, Action, COUNT(*) AS Total
FROM dbo.vw_ProfessorActivity
GROUP BY Username, Action
ORDER BY Username, Total DESC;
```

### What is NOT logged

- AI face recognition writes to `SessionAttendance` and `SessionRecognitions` — no `SESSION_CONTEXT` set on those connections.
- `sp_FinalizeSession` writes to `Enrollments.HoursAbsentTotal` — called inside the stored procedure without professor context.
- Student-initiated face deletion (`DELETE /api/student/face`) — student token, not professor.
- Email sends (`EmailDispatchLog`) — already has its own log table.
- Import/restore operations — deliberately bypass finalization; triggers are skipped because no professor context is set during bulk restores.

---

## Migrations

| File | Status | What it adds |
|------|--------|-------------|
| `01_init_schema.sql` | Applied on setup | Full schema, all tables, procedures, views, seed data |
| `02_student_portal_migration.sql` | Applied on live server | `Students.FullNameKurdish`, `Students.PasswordHash`, `Students.FaceDeletedBySelf`, `Students.FaceDeletedAt`, table `StudentInviteTokens` |
| `03_professor_activity_triggers.sql` | Run manually | `ProfessorActivityLog` table, `vw_ProfessorActivity` view, 6 AFTER triggers |
| *(runtime)* `ensure_webauthn_table()` | Applied on first app startup | `WebAuthnCredentials` table (created by Python if absent) |

To run a migration manually on the server:

```bash
cd /opt/attendify
SA_PASS="$(grep MSSQL_SA_PASSWORD .env | cut -d= -f2)"
docker compose exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$SA_PASS" -C -d AttendanceAI \
  < /opt/attendify/database/<migration_file>.sql
```
