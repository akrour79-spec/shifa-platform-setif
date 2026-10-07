-- =========================================================================
--  القسم 3 : إغلاق تسريب بيانات المرضى   ←  الأهم
-- =========================================================================
--  ⚠️ الصق هذا كدفعة واحدة في SQL Editor واضغط Run.
--     محرّر Supabase يغلّف الحزمة كلها في transaction واحدة:
--     أي خطأ واحد يُرجِع كل ما نجح. لذلك لا تُقسّمه.
--
--  قبل هذا القسم: أي شخص على الإنترنت يقرأ/يعدّل/يحذف كل المواعيد
--  (الأسماء + أرقام الهواتف) عبر REST API بمفتاح anon.
--  بعده: المتصفح لا يصل لقاعدة البيانات إطلاقاً.
--  كل الصلاحيات تُطبَّق في طبقة Express (server/middleware/auth.js).
-- =========================================================================

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

-- 4) منح service_role صلاحية كاملة (يستخدمه Express فقط).
--    ملاحظة: USAGE صلاحية للمتتاليات (sequences) وليست للجداول.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 5) افتراضيات دائمة: أي جدول يُنشأ لاحقاً لا يُتاح لـ anon تلقائياً
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON SEQUENCES TO service_role;

-- 6) الفحص النهائي: نجاحُه يعني أن التسريب مغلق
DO $$
BEGIN
    IF has_table_privilege('anon', 'public.appointments', 'SELECT') THEN
        RAISE EXCEPTION 'فشل التأمين: anon لا يزال يقرأ appointments';
    END IF;
    IF has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
        RAISE EXCEPTION 'فشل التأمين: anon لا يزال يقرأ profiles';
    END IF;
    IF has_table_privilege('authenticated', 'public.appointments', 'SELECT') THEN
        RAISE EXCEPTION 'فشل التأمين: authenticated لا يزال يقرأ appointments';
    END IF;
    RAISE NOTICE 'تم بنجاح: التسريب مغلق';
END $$;