-- 005_chargily_payments.sql — جدول مدفوعات البوابة بالبطاقة الذهبية / CIB

CREATE TABLE IF NOT EXISTS public.subscriptions_payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id             TEXT REFERENCES public.doctors(id) ON DELETE SET NULL,
    chargily_checkout_id  TEXT UNIQUE,
    amount                NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    currency              TEXT NOT NULL DEFAULT 'dzd',
    plan_id               TEXT NOT NULL,
    billing_cycle         TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    payment_method        TEXT NOT NULL DEFAULT 'edahabia' CHECK (payment_method IN ('edahabia', 'cib')),
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
    checkout_url          TEXT,
    raw_payload           JSONB,
    paid_at               TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON public.subscriptions_payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_doctor ON public.subscriptions_payments(doctor_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions_payments TO service_role;
ALTER TABLE public.subscriptions_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions_payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions_payments FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_payments_touch ON public.subscriptions_payments;
CREATE TRIGGER trg_payments_touch BEFORE UPDATE ON public.subscriptions_payments
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
