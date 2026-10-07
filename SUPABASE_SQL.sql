-- ############################################################################
--  منصة شفاء — ملف SQL واحد لتأمين قاعدة البيانات وإنشاء الجداول
-- ############################################################################
--
--  الاستخدام: افتح لوحة Supabase ← SQL Editor ← New query
--             الصق كل هذا الملف ← اضغط Run
--
--  ⚠️ سيُحذف الجدول appointments القديم (بيانات تجريبية مكشوفة ومقروءة
--     من أي شخص عبر الإنترنت بمفتاح anon). هذا مقصود.
--
--  ✅ آمن للتكرار: يمكنك تشغيله أكثر من مرة دون أخطاء.
--
--  هذه العملية تُغلق تسريب بيانات المرضى. لا تُؤجّلها.
-- ############################################################################


-- ############################################################################
--  القسم 1 من 3 : حذف الجداول القديمة المفتوحة
-- ############################################################################
DROP TABLE IF EXISTS public.appointments CASCADE;


-- ############################################################################
--  القسم 2 من 3 : إنشاء الجداول والفهارس وقيود منع الحجز المزدوج
-- ############################################################################
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- البلديات
CREATE TABLE IF NOT EXISTS public.communes (
    id         TEXT PRIMARY KEY,
    name_ar    TEXT NOT NULL UNIQUE,
    sort_order INT  NOT NULL DEFAULT 0
);

-- التخصصات
CREATE TABLE IF NOT EXISTS public.specialties (
    id         TEXT PRIMARY KEY,
    name_ar    TEXT NOT NULL UNIQUE,
    icon       TEXT,
    sort_order INT  NOT NULL DEFAULT 0
);

-- المستخدمون (مرضى / أطباء / موظفون استقبال)
CREATE TABLE IF NOT EXISTS public.profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'patient'
                  CHECK (role IN ('patient','doctor','secretary','admin')),
    commune_id    TEXT REFERENCES public.communes(id) ON DELETE SET NULL,
    specialty_id  TEXT REFERENCES public.specialties(id) ON DELETE SET NULL,
    clinic_name   TEXT,
    has_chifa     BOOLEAN NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role) WHERE is_active;

-- الأطباء والعيادات
CREATE TABLE IF NOT EXISTS public.doctors (
    id             TEXT PRIMARY KEY DEFAULT ('doc-' || substr(gen_random_uuid()::TEXT, 1, 8)),
    profile_id     UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    title          TEXT NOT NULL,
    specialty_id   TEXT NOT NULL REFERENCES public.specialties(id),
    commune_id     TEXT NOT NULL REFERENCES public.communes(id),
    address        TEXT NOT NULL,
    lat            NUMERIC(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng            NUMERIC(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
    phone          TEXT NOT NULL,
    price          NUMERIC(10,2) NOT NULL DEFAULT 2000 CHECK (price >= 0),
    rating         NUMERIC(2,1) NOT NULL DEFAULT 4.9 CHECK (rating BETWEEN 0 AND 5),
    reviews_count  INT NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
    has_chifa      BOOLEAN NOT NULL DEFAULT TRUE,
    work_hours     TEXT NOT NULL DEFAULT '08:00 - 16:30',
    available_days TEXT NOT NULL DEFAULT 'السبت - الخميس',
    slot_minutes   INT NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON public.doctors(specialty_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_doctors_commune   ON public.doctors(commune_id)   WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_doctors_geo       ON public.doctors(lat, lng);

-- المواعيد + طابور الانتظار
CREATE TABLE IF NOT EXISTS public.appointments (
    id            TEXT PRIMARY KEY DEFAULT ('APT-' || lpad(floor(random() * 900000 + 100000)::TEXT, 6, '0')),
    patient_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    doctor_id     TEXT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    patient_name  TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    commune_id    TEXT REFERENCES public.communes(id) ON DELETE SET NULL,
    appt_date     DATE NOT NULL,
    appt_time     TIME NOT NULL,
    status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','waiting','in_consultation','completed','cancelled','no_show')),
    queue_number  INT NOT NULL CHECK (queue_number > 0),
    has_chifa     BOOLEAN NOT NULL DEFAULT TRUE,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- منع الحجز المزدوج: لا يمكن حجز نفس التوقيت مرتين لنفس الطبيب
CREATE UNIQUE INDEX IF NOT EXISTS uniq_doctor_slot
    ON public.appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';

-- رقم الدور فريد لكل طبيب في كل يوم
CREATE UNIQUE INDEX IF NOT EXISTS uniq_doctor_queue_day
    ON public.appointments (doctor_id, appt_date, queue_number);

-- فهارس الاستعلام الساخن (لوحة الطبيب + شاشة الطابور)
CREATE INDEX IF NOT EXISTS idx_appt_doctor_day ON public.appointments(doctor_id, appt_date);
CREATE INDEX IF NOT EXISTS idx_appt_patient     ON public.appointments(patient_id, appt_date DESC);
CREATE INDEX IF NOT EXISTS idx_appt_queue_active ON public.appointments(doctor_id, appt_date, queue_number)
    WHERE status IN ('confirmed','waiting','in_consultation');

-- طابور الإشعارات (WhatsApp & SMS)
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

-- جدول مدفوعات البوابة بالبطاقة الذهبية / CIB (Chargily Pay)
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

-- تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_touch    ON public.profiles;
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_doctors_touch     ON public.doctors;
CREATE TRIGGER trg_doctors_touch BEFORE UPDATE ON public.doctors
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_appointments_touch ON public.appointments;
CREATE TRIGGER trg_appointments_touch BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ############################################################################
--  القسم 3 من 3 : إغلاق تسريب بيانات المرضى   ←  الأهم
-- ############################################################################
--  قبل هذا القسم: أي شخص على الإنترنت يستطيع قراءة وتعديل وحذف كل
--  المواعيد (الأسماء + أرقام الهواتف) عبر REST API بمفتاح anon.
--  بعد هذا القسم: المتصفح لا يستطيع الوصول لقاعدة البيانات إطلاقاً.
--  كل الصلاحيات تُطبَّق في طبقة Express (server/middleware/auth.js).
-- ############################################################################

DO $$
DECLARE
    t TEXT;
BEGIN
    -- 1) منع anon و authenticated على كل الجداول
    --    EXECUTE لا يقبل NULL ولا نصاً فارغاً، لذا نتحقق أولاً
    IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') > 0 THEN
        EXECUTE (SELECT string_agg(format('REVOKE ALL ON public.%I FROM anon, authenticated', tablename), '; ')
                 FROM pg_tables WHERE schemaname = 'public');
    END IF;

    -- 2) منعهم على كل الدوال
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'touch_updated_at') > 0 THEN
        EXECUTE (SELECT string_agg(format('REVOKE ALL ON FUNCTION public.%I FROM anon, authenticated', p.proname), '; ')
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'touch_updated_at');
    END IF;

    -- 3) تفعيل RLS على كل الجداول. بدون policies => منع افتراضي
    --    لأي دور لا يتجاوز RLS (بما فيه anon).
    FOREACH t IN ARRAY (
        SELECT COALESCE(array_agg(tablename::TEXT), ARRAY[]::TEXT[])
        FROM pg_tables WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- 4) منح service_role صلاحية كاملة (يستخدمه Express فقط)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 5) افتراضيات دائمة: أي جدول يُنشأ لاحقاً لا يُتاح لـ anon تلقائياً
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON SEQUENCES TO service_role;

-- 6) فحص نهائي: لو نفّذ هذا السطر بنجاح فالتأمين اكتمل
DO $$
BEGIN
    IF has_table_privilege('anon', 'public.appointments', 'SELECT') THEN
        RAISE EXCEPTION 'فشل التأمين: anon لا يزال يقرأ جدول appointments';
    END IF;
    RAISE NOTICE 'تم بنجاح: anon محجوب عن كل الجداول';
END $$;


-- ############################################################################
--  انتهى. الجداول أُنشئت والوصول العام مُغلق.
-- ############################################################################


-- הסجل الطبي والفيشة الطبية للمرضى
CREATE TABLE IF NOT EXISTS public.patient_medical_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    patient_phone     TEXT NOT NULL,
    doctor_id         TEXT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    appointment_id    TEXT REFERENCES public.appointments(id) ON DELETE SET NULL,
    diagnosis         TEXT NOT NULL,
    symptoms          TEXT,
    prescription_json JSONB,
    doctor_notes      TEXT,
    vital_signs       JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_med_records_patient_phone ON public.patient_medical_records(patient_phone);
CREATE INDEX IF NOT EXISTS idx_med_records_doctor ON public.patient_medical_records(doctor_id);
