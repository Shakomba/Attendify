/*
    Professor Activity Audit — Migration 03
    =========================================
    Creates ProfessorActivityLog and six AFTER triggers that write to it.

    Attribution mechanism
    ---------------------
    Triggers have no HTTP context, so the Python layer stamps each database
    connection with the authenticated professor's ID using SQL Server session
    context before executing any statement:

        EXEC sys.sp_set_session_context N'professor_id', <id>;

    Triggers read it back with:

        CAST(SESSION_CONTEXT(N'professor_id') AS INT)

    When the value is NULL (AI recognition, stored procedures, migrations),
    the trigger returns immediately without writing anything.

    Navigation queries
    ------------------
    -- Full audit log, newest first:
    SELECT * FROM dbo.vw_ProfessorActivity ORDER BY OccurredAt DESC;

    -- Activity for a specific professor:
    SELECT * FROM dbo.vw_ProfessorActivity WHERE Username = 'mr.halgurd' ORDER BY OccurredAt DESC;

    -- All grade changes this week:
    SELECT * FROM dbo.vw_ProfessorActivity
    WHERE Action = 'grade_update'
      AND OccurredAt >= DATEADD(DAY, -7, SYSUTCDATETIME())
    ORDER BY OccurredAt DESC;

    -- Everything a professor did in a single session:
    SELECT * FROM dbo.vw_ProfessorActivity
    WHERE TargetID LIKE '%<session-uuid>%'
    ORDER BY OccurredAt;

    -- Count actions per professor:
    SELECT Username, Action, COUNT(*) AS Total
    FROM dbo.vw_ProfessorActivity
    GROUP BY Username, Action
    ORDER BY Username, Total DESC;
*/

USE AttendanceAI;
GO

-- ── Audit log table ───────────────────────────────────────────────────────────

IF OBJECT_ID(N'dbo.ProfessorActivityLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProfessorActivityLog
    (
        LogID        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProfessorActivityLog PRIMARY KEY,
        ProfessorID  INT                  NULL,      -- NULL = system/AI (no SESSION_CONTEXT)
        Action       NVARCHAR(60)         NOT NULL,
        TargetTable  NVARCHAR(60)         NOT NULL,
        TargetID     NVARCHAR(200)        NULL,      -- Stringified PK of the affected row
        Detail       NVARCHAR(MAX)        NULL,      -- Human-readable summary of what changed
        OccurredAt   DATETIME2(0)         NOT NULL
            CONSTRAINT DF_ProfActivityLog_OccurredAt DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_ProfActivityLog_Professor
        ON dbo.ProfessorActivityLog (ProfessorID, OccurredAt DESC);

    CREATE INDEX IX_ProfActivityLog_Time
        ON dbo.ProfessorActivityLog (OccurredAt DESC);
END
GO

-- ── Convenience view (join to Professors for readable names) ──────────────────

IF OBJECT_ID(N'dbo.vw_ProfessorActivity', N'V') IS NOT NULL
    DROP VIEW dbo.vw_ProfessorActivity;
GO

CREATE VIEW dbo.vw_ProfessorActivity
AS
SELECT
    l.LogID,
    l.ProfessorID,
    p.Username,
    p.FullName   AS ProfessorName,
    l.Action,
    l.TargetTable,
    l.TargetID,
    l.Detail,
    l.OccurredAt
FROM dbo.ProfessorActivityLog l
LEFT JOIN dbo.Professors p ON p.ProfessorID = l.ProfessorID;
GO

-- ── Trigger 1: ClassSessions — session start and finalize ─────────────────────

CREATE OR ALTER TRIGGER dbo.trg_ClassSessions_Audit
ON dbo.ClassSessions
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ProfessorID INT = CAST(SESSION_CONTEXT(N'professor_id') AS INT);
    IF @ProfessorID IS NULL RETURN;

    -- Session started (INSERT row)
    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'session_start',
        N'ClassSessions',
        CAST(i.SessionID AS NVARCHAR(200)),
        N'CourseID=' + CAST(i.CourseID AS NVARCHAR(20))
    FROM INSERTED i
    WHERE NOT EXISTS (SELECT 1 FROM DELETED d WHERE d.SessionID = i.SessionID);

    -- Session finalized (Status transitioned active → finalized)
    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'session_finalize',
        N'ClassSessions',
        CAST(i.SessionID AS NVARCHAR(200)),
        N'CourseID=' + CAST(i.CourseID AS NVARCHAR(20))
            + N', Duration='
            + CAST(DATEDIFF(MINUTE, d.StartedAt, ISNULL(i.EndedAt, SYSUTCDATETIME())) AS NVARCHAR(20))
            + N'min'
    FROM INSERTED i
    JOIN DELETED d ON d.SessionID = i.SessionID
    WHERE d.Status = N'active' AND i.Status = N'finalized';
END;
GO

-- ── Trigger 2: Enrollments — grade changes ────────────────────────────────────

CREATE OR ALTER TRIGGER dbo.trg_Enrollments_Audit
ON dbo.Enrollments
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ProfessorID INT = CAST(SESSION_CONTEXT(N'professor_id') AS INT);
    IF @ProfessorID IS NULL RETURN;

    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'grade_update',
        N'Enrollments',
        N'StudentID=' + CAST(i.StudentID AS NVARCHAR(20))
            + N', CourseID=' + CAST(i.CourseID AS NVARCHAR(20)),
        CONCAT(
            CASE WHEN d.Quiz1            <> i.Quiz1            THEN N'Quiz1: '      + CAST(d.Quiz1            AS NVARCHAR(20)) + N' → ' + CAST(i.Quiz1            AS NVARCHAR(20)) + N'; ' ELSE N'' END,
            CASE WHEN d.Quiz2            <> i.Quiz2            THEN N'Quiz2: '      + CAST(d.Quiz2            AS NVARCHAR(20)) + N' → ' + CAST(i.Quiz2            AS NVARCHAR(20)) + N'; ' ELSE N'' END,
            CASE WHEN d.ProjectGrade     <> i.ProjectGrade     THEN N'Project: '    + CAST(d.ProjectGrade     AS NVARCHAR(20)) + N' → ' + CAST(i.ProjectGrade     AS NVARCHAR(20)) + N'; ' ELSE N'' END,
            CASE WHEN d.AssignmentGrade  <> i.AssignmentGrade  THEN N'Assignment: ' + CAST(d.AssignmentGrade  AS NVARCHAR(20)) + N' → ' + CAST(i.AssignmentGrade  AS NVARCHAR(20)) + N'; ' ELSE N'' END,
            CASE WHEN d.MidtermGrade     <> i.MidtermGrade     THEN N'Midterm: '    + CAST(d.MidtermGrade     AS NVARCHAR(20)) + N' → ' + CAST(i.MidtermGrade     AS NVARCHAR(20)) + N'; ' ELSE N'' END,
            CASE WHEN d.FinalExamGrade   <> i.FinalExamGrade   THEN N'FinalExam: '  + CAST(d.FinalExamGrade   AS NVARCHAR(20)) + N' → ' + CAST(i.FinalExamGrade   AS NVARCHAR(20)) + N'; ' ELSE N'' END,
            CASE WHEN d.HoursAbsentTotal <> i.HoursAbsentTotal THEN N'HoursAbsent: '+ CAST(d.HoursAbsentTotal AS NVARCHAR(20)) + N' → ' + CAST(i.HoursAbsentTotal AS NVARCHAR(20)) + N'; ' ELSE N'' END
        )
    FROM INSERTED i
    JOIN DELETED d ON d.EnrollmentID = i.EnrollmentID
    WHERE
        d.Quiz1            <> i.Quiz1            OR
        d.Quiz2            <> i.Quiz2            OR
        d.ProjectGrade     <> i.ProjectGrade     OR
        d.AssignmentGrade  <> i.AssignmentGrade  OR
        d.MidtermGrade     <> i.MidtermGrade     OR
        d.FinalExamGrade   <> i.FinalExamGrade   OR
        d.HoursAbsentTotal <> i.HoursAbsentTotal;
END;
GO

-- ── Trigger 3: SessionAttendance — manual attendance overrides ────────────────
--
--  sp_UpsertAttendanceOnRecognition also writes to this table, but it runs
--  without SESSION_CONTEXT set, so those writes are silently skipped.
--  Only rows written while a professor connection is active are logged.

CREATE OR ALTER TRIGGER dbo.trg_SessionAttendance_Audit
ON dbo.SessionAttendance
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ProfessorID INT = CAST(SESSION_CONTEXT(N'professor_id') AS INT);
    IF @ProfessorID IS NULL RETURN;

    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'attendance_override',
        N'SessionAttendance',
        N'SessionID=' + CAST(i.SessionID AS NVARCHAR(150))
            + N', StudentID=' + CAST(i.StudentID AS NVARCHAR(20)),
        CASE WHEN i.IsPresent = 1 THEN N'marked_present' ELSE N'marked_absent' END
    FROM INSERTED i;
END;
GO

-- ── Trigger 4: Students — new student added ───────────────────────────────────

CREATE OR ALTER TRIGGER dbo.trg_Students_Audit
ON dbo.Students
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ProfessorID INT = CAST(SESSION_CONTEXT(N'professor_id') AS INT);
    IF @ProfessorID IS NULL RETURN;

    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'student_created',
        N'Students',
        CAST(i.StudentID AS NVARCHAR(20)),
        N'Name=' + i.FullName + N', Email=' + i.Email
    FROM INSERTED i;
END;
GO

-- ── Trigger 5: StudentFaceEmbeddings — face uploaded or deleted ───────────────

CREATE OR ALTER TRIGGER dbo.trg_FaceEmbeddings_Audit
ON dbo.StudentFaceEmbeddings
AFTER INSERT, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ProfessorID INT = CAST(SESSION_CONTEXT(N'professor_id') AS INT);
    IF @ProfessorID IS NULL RETURN;

    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'face_uploaded',
        N'StudentFaceEmbeddings',
        CAST(i.StudentID AS NVARCHAR(20)),
        N'Pose=' + i.PoseLabel + N', Model=' + i.ModelName
    FROM INSERTED i;

    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'face_deleted',
        N'StudentFaceEmbeddings',
        CAST(d.StudentID AS NVARCHAR(20)),
        N'Pose=' + d.PoseLabel + N', Model=' + d.ModelName
    FROM DELETED d;
END;
GO

-- ── Trigger 6: Professors — profile changes ───────────────────────────────────

CREATE OR ALTER TRIGGER dbo.trg_Professors_Audit
ON dbo.Professors
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ProfessorID INT = CAST(SESSION_CONTEXT(N'professor_id') AS INT);
    IF @ProfessorID IS NULL RETURN;

    INSERT INTO dbo.ProfessorActivityLog (ProfessorID, Action, TargetTable, TargetID, Detail)
    SELECT
        @ProfessorID,
        N'profile_updated',
        N'Professors',
        CAST(i.ProfessorID AS NVARCHAR(20)),
        CONCAT(
            CASE WHEN d.FullName     <> i.FullName     OR (d.FullName IS NULL AND i.FullName IS NOT NULL)
                 THEN N'FullName changed; '   ELSE N'' END,
            CASE WHEN d.Username     <> i.Username
                 THEN N'Username: ' + d.Username + N' → ' + i.Username + N'; ' ELSE N'' END,
            CASE WHEN d.PasswordHash <> i.PasswordHash
                 THEN N'Password changed; '  ELSE N'' END
        )
    FROM INSERTED i
    JOIN DELETED d ON d.ProfessorID = i.ProfessorID;
END;
GO
