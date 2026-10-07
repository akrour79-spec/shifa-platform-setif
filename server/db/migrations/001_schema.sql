-- =========================================================================
-- 001_schema.sql — المخطط الأساسي لمنصة شفاء سطيف
-- =========================================================================
-- قاعدة البيانات هي مصدر الحقيقة الوحيد. لا يوجد أي وصول مباشر من المتصفح.
-- كل الصلاحيات تُفرض في طبقة Express (server/middleware/auth.js).
-- =========================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- جداول مرجعية
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.communes (
    id         TEXT PRIMARY KEY,
    name_ar    TEXT NOT NULL UNIQUE,
    sort_order INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.specialties (
    id         TEXT PRIMARY KEY,
    name_ar    TEXT NOT NULL UNIQUE,
    icon       TEXT,
    sort_order INT  NOT NULL DEFAULT 0
);

-- -------------------------------------------------------------------------
-- المستخدمون (المرضى / الأطباء / Scolières)
-- phone بصيغة E.164: +213XXXXXXXXX  (5 ولايات connects Algeria)
-- -------------------------------------------------------------------------

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

-- -------------------------------------------------------------------------
-- الأطباء والعيادات
-- -------------------------------------------------------------------------

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
    -- خطة الاستعجال: يتوقف الحجز قبل الموعد بساعتين
    slot_minutes   INT NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON public.doctors(specialty_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_doctors_commune   ON public.doctors(commune_id)   WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_doctors_geo       ON public.doctors(lat, lng);

-- -------------------------------------------------------------------------
-- المواعيد + طابور الانتظار
--
-- ملاحظة التصميم: statuses تُخزَّن بالإنجليزية (canonical) وتُترجَم في طبقة
-- الـ API إلى العربية. هذا يمنع تسلل نصوص عربية إلى شروط WHERE/SQL.
-- -------------------------------------------------------------------------

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
-- (الفهرس الجزئي يستثني المواعيد الملغاة حتى يمكن إعادة الحجز لاحقاً)
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

-- -------------------------------------------------------------------------
-- تحديث updated_at تلقائياً
-- -------------------------------------------------------------------------

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