-- =========================================================================
-- 002_security_lockdown.sql — إغلاق تسريب بيانات المرضى
-- =========================================================================
-- المشكلة المكتشفة:
--   جدول appointments كان مفتوحاً بالكامل لـ anon عبر REST API، أي أن أي
--   شخص يستطيع القراءة/التعديل/الحذف بمفتاح anon المنشور في كود الواجهة.
--
-- العلاج: من الآن، قاعدة البيانات غير قابلة للوصول من المتصفح إطلاقاً.
--   • service_role (يستخدمه Express فقط) يتجاوز RLS → يمر
--   • anon / authenticated  → مُنعون من GRANT + RLS بلا سياسات → يُمنعون
--
-- كل الصلاحيات تُطبَّق في طبقة Express. طبقة واحدة موحّدة هي المرجع
-- بدلاً من توزيع سياسات RLS على كل جدول (وهو مصدر الأخطاء الأصلي).
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

    -- 3) تفعيل RLS على كل الجداول. بدون policies => deny-by-default
    --    لأي دور لا يتجاوز RLS (بما فيه anon).
    FOREACH t IN ARRAY (
        SELECT COALESCE(array_agg(tablename::TEXT), ARRAY[]::TEXT[])
        FROM pg_tables WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- 4) منح service_role صلاحية كاملة (هو ما يستخدمه Express فقط).
--    ملاحظة: service_role يتجاوز RLS تلقائياً، والمنح هنا يغطي حالة
--    مشروع جديد لم يُطبَّق فيه default privileges بعد.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 5) افتراضيات دائمة: أي جدول يُنشأ لاحقاً لا يُتاح لـ anon تلقائياً
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  ALL ON SEQUENCES TO service_role;

-- 6) sanity check: تأكيد أنanon لم يعد يستطيع القراءة
DO $$
BEGIN
    IF has_table_privilege('anon', 'public.appointments', 'SELECT') THEN
        RAISE EXCEPTION 'SECURITY FAILURE: anon لا يزال يملك صلاحية SELECT على appointments';
    END IF;
    RAISE NOTICE 'OK: anon محجوب عن public.appointments';
END $$;