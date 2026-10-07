-- =========================================================================
-- 003_doctor_onboarding.sql — تمييز البيانات التجريبية + أساس انضمام الأطباء
-- =========================================================================
-- الدافعان:
--
-- 1) شفافية البيانات:
--    الأسماء الثمانية الحالية (بن علي، بوزيد، مباركي...) أسماء متخيّلة وُضعت
--    للتجربة. عرضها في دليل العامة بلا أي إشارة إلى أنها بيانات تجريبية
--    يعرّض سمعة أشخاص حقيقيين يشبهون هذه الأسماء. عمود is_demo يجعل
--    الواجهة تُعلن ذلك صراحةً بدل أن تفترضه.
--
-- 2) انضمام طبيب حقيقي:
--    حتى الآن لا يوجد أي مسار ينشئ صفاً في public.doctors — التسجيل
--    يُنشئ صفاً في profiles فقط. أي أن "طبيباً يسجّل ولا يظهر" عيب
--    بنيوي لا يمكن إصلاحه من الواجهة. هذا الترحيل يجهّز العمود الذي
--    تعتمد عليه عملية التسجيل (انظر routes/auth.js).
--
-- ملاحظة على UPDATE أدناه: نضع is_demo = TRUE على كل الصفوف الموجودة الآن
-- لأنها كلها بيانات بذر (seed). هذا صحيح لأن هذا الترحيل يُنفَّذ مرة واحدة
-- قبل أن يوجد أي طبيب حقيقي — لا مسار اليوم ينشئ صفوفاً في doctors.
-- أي صف جديد يُنشئه routes/auth.js يأتي بـ is_demo = FALSE صراحةً.
-- =========================================================================

-- 1) عمود التمييز
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.doctors.is_demo IS
  'TRUE = بيانات تجريبية (بذر) — يجب أن تُعلن الواجهة ذلك. لا يصحّ أن يديره الطبيب بنفسه.';

-- 2) وسم كل ما هو موجود الآن كبيانات تجريبية
UPDATE public.doctors SET is_demo = TRUE WHERE is_demo = FALSE;

-- 3) فحص سلامة: العمود موجود، والصفوف الحالية موسومة
DO $$
DECLARE
    unmarked INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'doctors' AND column_name = 'is_demo'
    ) THEN
        RAISE EXCEPTION 'MIGRATION FAILURE: عمود doctors.is_demo لم يُنشأ';
    END IF;

    SELECT COUNT(*) INTO unmarked FROM public.doctors WHERE is_demo = FALSE;
    IF unmarked > 0 THEN
        RAISE EXCEPTION 'MIGRATION FAILURE: % صف بلا تسمية تجريبية', unmarked;
    END IF;

    RAISE NOTICE 'OK: doctors.is_demo جاهز — كل الصفوف الحالية موسومة كبيانات تجريبية';
END $$;