-- 007_whatsapp_provider.sql — تتبع معرّف الرسالة من مزود WhatsApp
-- يسمح بمطابقة حالة التسليم مع Meta Cloud API لاحقاً.

ALTER TABLE public.notifications_outbox
    ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE public.notifications_outbox
    ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'whatsapp-log';

CREATE INDEX IF NOT EXISTS idx_notifications_provider_msg
    ON public.notifications_outbox(provider_message_id)
    WHERE provider_message_id IS NOT NULL;
