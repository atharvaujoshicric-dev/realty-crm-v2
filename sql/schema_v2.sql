-- ================================================================
--  RealtyFlow CRM — Schema additions for v4
--  Run in Supabase SQL Editor AFTER existing schema is in place
-- ================================================================

-- ── AUDIT LOG TABLE ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id      UUID,   -- not FK so log persists if user deleted
  user_name    TEXT NOT NULL DEFAULT '',
  user_role    TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL,  -- 'create' | 'update' | 'cancel' | 'delete' | 'import'
  entity       TEXT NOT NULL,  -- 'booking' | 'cheque' | 'prev_booking' | 'project' | 'user'
  entity_id    UUID,
  entity_label TEXT DEFAULT '', -- e.g. client name or cheque ref
  changes      JSONB DEFAULT '{}'::JSONB, -- {field: {old, new}}
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_audit_project  ON public.audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_user     ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON public.audit_log(created_at DESC);

-- Disable RLS
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.audit_log TO anon, authenticated;

-- ── ADD cancelled_at TO BOOKINGS ─────────────────────────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancelled_by TEXT DEFAULT '';
