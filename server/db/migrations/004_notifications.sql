-- 004_notifications.sql — إضافة جدول طابور الإشعارات (SMS / WhatsApp)

CREATE TABLE IF NOT EXISTS public.notifications_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id  TEXT REFERENCES public.appointments(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
    recipient_phone TEXT NOT NULL,
    recipient_name  TEXT,
    message         TEXT NOT NULL,
    scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    error_message   TEXT,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending
    ON public.notifications_outbox(scheduled_for, status)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notifications_appt
    ON public.notifications_outbox(appointment_id);

-- منح الصلاحيات لـ service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications_outbox TO service_role;

-- RLS حماية
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications_outbox FROM anon, authenticated;

-- التريغر لتحديث updated_at
DROP TRIGGER IF EXISTS trg_notifications_touch ON public.notifications_outbox;
CREATE TRIGGER trg_notifications_touch BEFORE UPDATE ON public.notifications_outbox
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
