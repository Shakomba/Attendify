import { useCallback, useEffect, useState } from 'react'
import {
    ShieldCheck, RefreshCw, Plus, Loader2, CheckCircle2,
    AlertTriangle, ChevronDown, ChevronUp, Eye, EyeOff,
} from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { parseDateSafe, formatDate, formatTime } from '../../lib/dateFormatter'

/* ── Action badge ──────────────────────────────────────────────────── */

const ACTION_META = {
    session_start:        { label: 'Session Start',    color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    session_finalize:     { label: 'Session End',      color: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
    grade_update:         { label: 'Grade Update',     color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    attendance_override:  { label: 'Attendance',       color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
    student_created:      { label: 'Student Added',    color: 'bg-green-500/10 text-green-600 border-green-500/20' },
    face_uploaded:        { label: 'Face Uploaded',    color: 'bg-teal-500/10 text-teal-600 border-teal-500/20' },
    face_deleted:         { label: 'Face Deleted',     color: 'bg-red-500/10 text-red-500 border-red-500/20' },
    profile_updated:      { label: 'Profile Update',   color: 'bg-zinc-500/10 text-secondary border-zinc-500/20' },
}

function ActionBadge({ action }) {
    const meta = ACTION_META[action] || { label: action, color: 'bg-zinc-500/10 text-secondary border-zinc-500/20' }
    return (
        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium border rounded-full whitespace-nowrap ${meta.color}`}>
            {meta.label}
        </span>
    )
}

/* ── Sub-tab pill ──────────────────────────────────────────────────── */

function SubTab({ id, active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={() => onClick(id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
                active ? 'bg-fg text-bg' : 'text-secondary hover:text-fg hover:bg-surface'
            }`}
        >
            {children}
        </button>
    )
}

/* ── Section header ────────────────────────────────────────────────── */

function SectionHeader({ title, description, action }) {
    return (
        <div className="flex items-start justify-between gap-4 mb-4">
            <div>
                <h3 className="text-sm font-semibold text-fg">{title}</h3>
                {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
            </div>
            {action}
        </div>
    )
}

/* ── Activity Log ──────────────────────────────────────────────────── */

const FILTER_OPTIONS = [
    { value: '',                   label: 'All actions'    },
    { value: 'session_start',      label: 'Session Start'  },
    { value: 'session_finalize',   label: 'Session End'    },
    { value: 'grade_update',       label: 'Grade Updates'  },
    { value: 'attendance_override',label: 'Attendance'     },
    { value: 'student_created',    label: 'Students Added' },
    { value: 'face_uploaded',      label: 'Face Uploads'   },
    { value: 'face_deleted',       label: 'Face Deletes'   },
    { value: 'profile_updated',    label: 'Profile'        },
]

function ActivityLog({ apiFetch }) {
    const { language } = useTranslation()
    const [items, setItems]         = useState([])
    const [loading, setLoading]     = useState(false)
    const [filter, setFilter]       = useState('')
    const [expanded, setExpanded]   = useState(null)

    const load = useCallback(async (action) => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ limit: '200' })
            if (action) params.set('action', action)
            const data = await apiFetch(`/api/admin/activity?${params}`)
            setItems(data.items || [])
        } catch (err) {
            console.error('Failed to load activity log:', err.message)
        } finally {
            setLoading(false)
        }
    }, [apiFetch])

    useEffect(() => { load(filter) }, [filter, load])

    const fmtTime = (iso) => {
        if (!iso) return '—'
        const d = parseDateSafe(iso)
        return `${formatDate(d, language, true)} ${formatTime(d, language)}`
    }

    return (
        <div>
            <SectionHeader
                title="Activity Log"
                description="All professor-initiated database changes, newest first."
                action={
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="relative">
                            <select
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                                className="ui-input text-xs pr-7 appearance-none cursor-pointer"
                            >
                                {FILTER_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
                        </div>
                        <button
                            type="button"
                            onClick={() => load(filter)}
                            disabled={loading}
                            className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5"
                        >
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                    </div>
                }
            />

            <div className="standard-card overflow-hidden">
                {/* Table header */}
                <div className="hidden sm:grid grid-cols-[160px_140px_130px_1fr] gap-3 px-4 py-2.5 border-b border-border bg-surface text-[10px] font-medium text-secondary uppercase tracking-wider">
                    <span>Time</span>
                    <span>Professor</span>
                    <span>Action</span>
                    <span>Detail</span>
                </div>

                {loading && items.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-secondary text-xs">
                        <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-secondary text-xs">
                        No activity recorded yet.
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {items.map((item) => (
                            <div key={item.LogID}>
                                {/* Desktop row */}
                                <div
                                    className="hidden sm:grid grid-cols-[160px_140px_130px_1fr] gap-3 px-4 py-3 hover:bg-surface/60 transition-colors items-start cursor-pointer"
                                    onClick={() => setExpanded(expanded === item.LogID ? null : item.LogID)}
                                >
                                    <span className="text-xs text-secondary font-mono whitespace-nowrap">
                                        {fmtTime(item.OccurredAt)}
                                    </span>
                                    <span className="text-xs font-medium text-fg truncate">
                                        {item.ProfessorName || item.Username || '—'}
                                    </span>
                                    <ActionBadge action={item.Action} />
                                    <span className="text-xs text-secondary truncate">
                                        {item.Detail || item.TargetID || '—'}
                                    </span>
                                </div>

                                {/* Mobile row */}
                                <div
                                    className="sm:hidden px-4 py-3 cursor-pointer hover:bg-surface/60 transition-colors"
                                    onClick={() => setExpanded(expanded === item.LogID ? null : item.LogID)}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <ActionBadge action={item.Action} />
                                        <span className="text-[10px] text-secondary font-mono">{fmtTime(item.OccurredAt)}</span>
                                    </div>
                                    <p className="text-xs font-medium text-fg">{item.ProfessorName || item.Username || '—'}</p>
                                    {item.Detail && <p className="text-xs text-secondary mt-0.5 truncate">{item.Detail}</p>}
                                </div>

                                {/* Expanded detail */}
                                {expanded === item.LogID && (
                                    <div className="px-4 pb-3 bg-surface border-t border-border">
                                        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs mt-2">
                                            <dt className="text-secondary">Table</dt>
                                            <dd className="font-mono text-fg">{item.TargetTable}</dd>
                                            <dt className="text-secondary">Row</dt>
                                            <dd className="font-mono text-fg break-all">{item.TargetID || '—'}</dd>
                                            <dt className="text-secondary">Detail</dt>
                                            <dd className="text-fg break-words">{item.Detail || '—'}</dd>
                                            <dt className="text-secondary">Log ID</dt>
                                            <dd className="font-mono text-secondary">{item.LogID}</dd>
                                        </dl>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <p className="text-[10px] text-secondary mt-2">
                Showing up to 200 entries. Use sqlcmd or Azure Data Studio for full export.
            </p>
        </div>
    )
}

/* ── Add Professor Form ────────────────────────────────────────────── */

function AddProfessorForm({ apiFetch, courses, onCreated }) {
    const [draft, setDraft] = useState({
        username: '', full_name: '', password: '', course_id: '', is_admin: false,
    })
    const [showPassword, setShowPassword] = useState(false)
    const [saving, setSaving]   = useState(false)
    const [error, setError]     = useState('')
    const [success, setSuccess] = useState(false)

    const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setSuccess(false)
        if (!draft.username || !draft.full_name || !draft.password || !draft.course_id) {
            setError('All fields are required.')
            return
        }
        setSaving(true)
        try {
            await apiFetch('/api/admin/professors', {
                method: 'POST',
                body: JSON.stringify({
                    username:  draft.username.trim(),
                    full_name: draft.full_name.trim(),
                    password:  draft.password,
                    course_id: Number(draft.course_id),
                    is_admin:  draft.is_admin,
                }),
            })
            setDraft({ username: '', full_name: '', password: '', course_id: '', is_admin: false })
            setSuccess(true)
            onCreated()
        } catch (err) {
            setError(err.message || 'Failed to create professor.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="standard-card px-4 sm:px-5 py-4 sm:py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                    <label className="block text-[11px] font-medium text-secondary mb-1.5">Full name</label>
                    <input
                        type="text"
                        value={draft.full_name}
                        onChange={e => set('full_name', e.target.value)}
                        placeholder="Dr. Jane Smith"
                        className="ui-input w-full"
                        autoComplete="off"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-secondary mb-1.5">Username</label>
                    <input
                        type="text"
                        value={draft.username}
                        onChange={e => set('username', e.target.value)}
                        placeholder="dr.jane"
                        className="ui-input w-full"
                        autoComplete="off"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-secondary mb-1.5">Password</label>
                    <div className="relative">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={draft.password}
                            onChange={e => set('password', e.target.value)}
                            placeholder="Min. 8 characters"
                            className="ui-input w-full pr-9"
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(v => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-fg transition-colors cursor-pointer"
                        >
                            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-secondary mb-1.5">Course</label>
                    <div className="relative">
                        <select
                            value={draft.course_id}
                            onChange={e => set('course_id', e.target.value)}
                            className="ui-input w-full pr-7 appearance-none cursor-pointer"
                        >
                            <option value="">Select a course…</option>
                            {courses.map(c => (
                                <option key={c.CourseID} value={c.CourseID}>
                                    {c.CourseCode} — {c.CourseName}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
                    </div>
                </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={draft.is_admin}
                    onChange={e => set('is_admin', e.target.checked)}
                    className="w-3.5 h-3.5 accent-fg cursor-pointer"
                />
                <span className="text-xs text-secondary">Grant admin access</span>
            </label>

            <div className="flex items-center justify-between gap-3 pt-1">
                <div className="text-xs min-h-[16px]">
                    {error && (
                        <span className="text-red-500 flex items-center gap-1">
                            <AlertTriangle size={11} /> {error}
                        </span>
                    )}
                    {success && !error && (
                        <span className="text-green-500 flex items-center gap-1">
                            <CheckCircle2 size={11} /> Professor created successfully.
                        </span>
                    )}
                </div>
                <button
                    type="submit"
                    disabled={saving}
                    className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
                >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    {saving ? 'Creating…' : 'Create Professor'}
                </button>
            </div>
        </form>
    )
}

/* ── Professors List ───────────────────────────────────────────────── */

function ProfessorsTab({ apiFetch }) {
    const { language } = useTranslation()
    const [professors, setProfessors] = useState([])
    const [courses, setCourses]       = useState([])
    const [loading, setLoading]       = useState(false)
    const [showForm, setShowForm]     = useState(false)

    const loadProfessors = useCallback(async () => {
        setLoading(true)
        try {
            const data = await apiFetch('/api/admin/professors')
            setProfessors(data.items || [])
        } catch (err) {
            console.error('Failed to load professors:', err.message)
        } finally {
            setLoading(false)
        }
    }, [apiFetch])

    const loadCourses = useCallback(async () => {
        try {
            const data = await apiFetch('/api/courses')
            setCourses(data.items || [])
        } catch { }
    }, [apiFetch])

    useEffect(() => {
        loadProfessors()
        loadCourses()
    }, [loadProfessors, loadCourses])

    const fmtDate = (iso) => {
        if (!iso) return '—'
        return formatDate(parseDateSafe(iso), language, true)
    }

    return (
        <div className="space-y-4">
            <SectionHeader
                title="Professors"
                description="All professor accounts in the system."
                action={
                    <button
                        type="button"
                        onClick={() => setShowForm(v => !v)}
                        className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5"
                    >
                        {showForm ? <ChevronUp size={12} /> : <Plus size={12} />}
                        {showForm ? 'Cancel' : 'Add Professor'}
                    </button>
                }
            />

            {showForm && (
                <AddProfessorForm
                    apiFetch={apiFetch}
                    courses={courses}
                    onCreated={() => { setShowForm(false); loadProfessors() }}
                />
            )}

            <div className="standard-card overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1fr_140px_1fr_80px_120px] gap-3 px-4 py-2.5 border-b border-border bg-surface text-[10px] font-medium text-secondary uppercase tracking-wider">
                    <span>Name</span>
                    <span>Username</span>
                    <span>Course</span>
                    <span>Role</span>
                    <span>Created</span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-secondary text-xs">
                        <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {professors.map((p) => (
                            <div key={p.ProfessorID} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_1fr_80px_120px] gap-1 sm:gap-3 px-4 py-3 hover:bg-surface/60 transition-colors items-center">
                                <div>
                                    <p className="text-sm font-medium text-fg">{p.FullName}</p>
                                    {!p.IsActive && (
                                        <span className="text-[10px] text-red-500">Inactive</span>
                                    )}
                                </div>
                                <span className="text-xs text-secondary font-mono" dir="ltr">@{p.Username}</span>
                                <span className="text-xs text-secondary">{p.CourseCode} — {p.CourseName}</span>
                                <span>
                                    {p.IsAdmin ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border rounded-full bg-fg/10 text-fg border-fg/20">
                                            <ShieldCheck size={10} /> Admin
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-secondary">Professor</span>
                                    )}
                                </span>
                                <span className="text-xs text-secondary">{fmtDate(p.CreatedAt)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

/* ── Main ──────────────────────────────────────────────────────────── */

export function AdminPage({ apiFetch }) {
    const [subTab, setSubTab] = useState('activity')

    return (
        <div className="max-w-5xl space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-sm bg-fg/[0.06] border border-border flex items-center justify-center">
                    <ShieldCheck size={16} className="text-secondary" />
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-fg">Admin Panel</h2>
                    <p className="text-xs text-secondary">Audit log and professor management</p>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex items-center gap-1 border-b border-border pb-3">
                <SubTab id="activity" active={subTab === 'activity'} onClick={setSubTab}>
                    Activity Log
                </SubTab>
                <SubTab id="professors" active={subTab === 'professors'} onClick={setSubTab}>
                    Professors
                </SubTab>
            </div>

            {subTab === 'activity'   && <ActivityLog   apiFetch={apiFetch} />}
            {subTab === 'professors' && <ProfessorsTab apiFetch={apiFetch} />}
        </div>
    )
}
