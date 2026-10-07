-- ============================================================================
-- Migration 006: Patient Medical Records & Clinical History System
-- ============================================================================

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
CREATE INDEX IF NOT EXISTS idx_med_records_patient ON public.patient_medical_records(patient_id);
