-- =========================================================================
-- 000_drop_legacy.sql
-- =========================================================================
-- الهدف: إزالة جدول appointments القديم الذي كان يُنشئه المتصفح نفسه
-- (client-side auto-create). كان مفتوحاً للعموم عبر مفتاح anon وفيه
-- قيماً تجريبية فيها أسماء وأرقام هواتف، لذلك يجب إتلافه.
--
-- حارس الأمان (أُضيف بعد فقدان بيانات فعلي):
-- كان هذا الملف "DROP TABLE IF EXISTS" صِرفاً. أي إعادة تشغيل للترحيلات
-- على قاعدة فيها مواعيد حقيقية كانت تمحوها بلا تحذير. الحارس الوحيد كان
-- جدول _migrations، وقد حدث أن كانت الجداول موجودة والسجل فارغاً، فعاد
-- الملف ومسح كل المواعيد.
--
-- القاعدة الآن: لا يُسقط هذا الملف جدولاً غير فارغ أبداً.
--   - الجدول الفارغ = جدول المتصفح القديم، يُسقط.
--   - الجدول غير الفارغ = جدول الإنتاج، يبقى.
--   - تعذّر التحقق = لا نُسقط. السلامة أهم من النظافة.
-- =========================================================================

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    IF to_regclass('public.appointments') IS NULL THEN
        RAISE NOTICE 'SKIP: لا يوجد جدول appointments';
        RETURN;
    END IF;

    BEGIN
        EXECUTE 'SELECT count(*) FROM public.appointments' INTO row_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'SKIP: تعذّرت قراءة الجدول (%) — لم يُسقط حفاظاً على البيانات', SQLERRM;
        RETURN;
    END;

    IF row_count > 0 THEN
        RAISE NOTICE 'SKIP: الجدول يحوي % صف — ليس الجدول القديم، لم يُسقط', row_count;
        RETURN;
    END IF;

    EXECUTE 'DROP TABLE public.appointments CASCADE';
    RAISE NOTICE 'OK: أُسقط جدول appointments القديم (كان فارغاً)';
END $$;