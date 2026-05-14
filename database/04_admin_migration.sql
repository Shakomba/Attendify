-- Admin Migration — adds IsAdmin flag to Professors
-- Run once. Designates dr.ahmed as the initial admin account.

USE AttendanceAI;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Professors') AND name = N'IsAdmin'
)
BEGIN
    ALTER TABLE dbo.Professors
        ADD IsAdmin BIT NOT NULL CONSTRAINT DF_Professors_IsAdmin DEFAULT (0);
END
GO

UPDATE dbo.Professors SET IsAdmin = 1 WHERE Username = N'dr.ahmed';
GO
