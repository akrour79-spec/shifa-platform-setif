-- 008_reviews.sql — نظام تقييمات الأطباء
-- المريض يقيّم الطبيب بعد الموعد (نجمة 1-5 + تعليق اختياري)

CREATE TABLE IF NOT EXISTS public.reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id   TEXT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    patient_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT CHECK (char_length(comment) <= 1000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- تقييم واحد لكل مريض لكل طبيب (يمكن التحديث)
    UNIQUE (doctor_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_doctor ON public.reviews(doctor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON public.reviews(created_at DESC);

-- دالة تحديث متوسط التقييم وعدد المراجعات للطبيب
CREATE OR REPLACE FUNCTION refresh_doctor_rating(p_doctor_id TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.doctors d
    SET rating = COALESCE(
            (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM public.reviews r WHERE r.doctor_id = p_doctor_id),
            0
        ),
        reviews_count = COALESCE(
            (SELECT COUNT(*) FROM public.reviews r WHERE r.doctor_id = p_doctor_id),
            0
        )
    WHERE d.id = p_doctor_id;
END;
$$ LANGUAGE plpgsql;
