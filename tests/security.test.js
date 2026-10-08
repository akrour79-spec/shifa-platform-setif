/**
 * tests/security.test.js — اختبارات التكامل الأمنية (لا تحتاج قاعدة بيانات)
 * -----------------------------------------------------------------------------
 * تغطي الإصلاحات الأمنية الحرجة:
 *  1. تأكيد الدفع يتحقق مع Chargily ويفشل بأمان (fail-closed)
 *  2. الـ webhook يرفض الإشعارات غير الموقعة في الإنتاج
 *  3. شاشة الطابور العامة تقنّع أسماء المرضى وتحذف الهواتف
 * التشغيل: npm test
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  getCheckoutStatus,
  verifyWebhookSignature,
} = require('../server/lib/chargily');
const queueRoute = require('../server/routes/queue');
const { maskNameForScreen, shapeScreenRow } = queueRoute;

// ===========================================================================
describe('تأكيد الدفع — التحقق مع Chargily (fail-closed)', () => {
  test('بلا مفتاح Chargily: التحقق مستحيل → verified=false', async () => {
    const saved = process.env.CHARGILY_SECRET_KEY;
    delete process.env.CHARGILY_SECRET_KEY;
    try {
      const r = await getCheckoutStatus('co_anything');
      assert.equal(r.verified, false);
      assert.equal(r.status, null);
    } finally {
      if (saved !== undefined) process.env.CHARGILY_SECRET_KEY = saved;
    }
  });

  test('بلا معرّف تخليص: verified=false حتى مع وجود مفتاح', async () => {
    process.env.CHARGILY_SECRET_KEY = 'test_key';
    try {
      const r = await getCheckoutStatus('');
      assert.equal(r.verified, false);
    } finally {
      delete process.env.CHARGILY_SECRET_KEY;
    }
  });

  test('فشل الشبكة أثناء التحقق → verified=false (لا يُقبل الدفع)', async () => {
    process.env.CHARGILY_SECRET_KEY = 'test_key';
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('network down'); };
    try {
      const r = await getCheckoutStatus('co_123');
      assert.equal(r.verified, false);
      assert.equal(r.status, null);
    } finally {
      global.fetch = origFetch;
      delete process.env.CHARGILY_SECRET_KEY;
    }
  });

  test('رد غير ناجح من Chargily → verified=false', async () => {
    process.env.CHARGILY_SECRET_KEY = 'test_key';
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 404 });
    try {
      const r = await getCheckoutStatus('co_nope');
      assert.equal(r.verified, false);
    } finally {
      global.fetch = origFetch;
      delete process.env.CHARGILY_SECRET_KEY;
    }
  });

  test('رد ناجح بحالة paid → verified=true, status=paid', async () => {
    process.env.CHARGILY_SECRET_KEY = 'test_key';
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ id: 'co_123', status: 'paid' }),
    });
    try {
      const r = await getCheckoutStatus('co_123');
      assert.equal(r.verified, true);
      assert.equal(r.status, 'paid');
    } finally {
      global.fetch = origFetch;
      delete process.env.CHARGILY_SECRET_KEY;
    }
  });
});

// ===========================================================================
describe('توقيع الـ webhook', () => {
  const SECRET = 'whsec_test_123';
  const BODY = '{"event":"checkout.paid","data":{"id":"co_1"}}';

  test('توقيع صحيح يُقبل', () => {
    process.env.CHARGILY_WEBHOOK_SECRET = SECRET;
    try {
      const sig = crypto.createHmac('sha256', SECRET).update(BODY).digest('hex');
      assert.equal(verifyWebhookSignature(sig, BODY), true);
    } finally {
      delete process.env.CHARGILY_WEBHOOK_SECRET;
    }
  });

  test('توقيع خاطئ يُرفض', () => {
    process.env.CHARGILY_WEBHOOK_SECRET = SECRET;
    try {
      assert.equal(verifyWebhookSignature('deadbeef'.repeat(8), BODY), false);
    } finally {
      delete process.env.CHARGILY_WEBHOOK_SECRET;
    }
  });

  test('توقيع صحيح لجسم مختلف يُرفض (replay/modification)', () => {
    process.env.CHARGILY_WEBHOOK_SECRET = SECRET;
    try {
      const sig = crypto.createHmac('sha256', SECRET).update(BODY).digest('hex');
      assert.equal(verifyWebhookSignature(sig, BODY + 'tampered'), false);
    } finally {
      delete process.env.CHARGILY_WEBHOOK_SECRET;
    }
  });

  test('بلا سرّ: كل التواقيع مرفوضة', () => {
    delete process.env.CHARGILY_WEBHOOK_SECRET;
    delete process.env.CHARGILY_SECRET_KEY;
    assert.equal(verifyWebhookSignature('anything', BODY), false);
  });

  test('بلا توقيع: مرفوض', () => {
    process.env.CHARGILY_WEBHOOK_SECRET = SECRET;
    try {
      assert.equal(verifyWebhookSignature('', BODY), false);
      assert.equal(verifyWebhookSignature(null, BODY), false);
    } finally {
      delete process.env.CHARGILY_WEBHOOK_SECRET;
    }
  });
});

// ===========================================================================
describe('تقنيع شاشة الطابور العامة', () => {
  test('الاسم الكامل → الاسم الأول فقط', () => {
    assert.equal(maskNameForScreen('محمد الأمين بن أحمد'), 'محمد');
    assert.equal(maskNameForScreen('  فاطمة  الزهراء  '), 'فاطمة');
    assert.equal(maskNameForScreen('يوسف'), 'يوسف');
  });

  test('اسم فارغ أو معدوم → "مريض"', () => {
    assert.equal(maskNameForScreen(''), 'مريض');
    assert.equal(maskNameForScreen('   '), 'مريض');
    assert.equal(maskNameForScreen(null), 'مريض');
    assert.equal(maskNameForScreen(undefined), 'مريض');
  });

  test('صف الشاشة لا يحتوي رقم الهاتف أبداً', () => {
    const row = shapeScreenRow({
      id: '1',
      queue_number: 5,
      patient_name: 'أحمد بن يوسف القادري',
      patient_phone: '+213555123456',
      phone: '0555123456',
      appt_date: '2026-10-08',
      appt_time: '09:30',
      status: 'waiting',
      status_ar: 'في الانتظار',
      status_tone: 'info',
      doctor_name: 'د. سمير',
    });
    assert.equal(row.patient_name, 'أحمد');
    assert.ok(!('patient_phone' in row), 'patient_phone مسرّب!');
    assert.ok(!('phone' in row), 'phone مسرّب!');
    assert.equal(row.queue_number, 5);
  });

  test('صف الشاشة يحافظ على الحقول اللازمة للعرض فقط', () => {
    const row = shapeScreenRow({
      id: '2', queue_number: 7, patient_name: 'خديجة',
      appt_date: '2026-10-08', appt_time: '10:00', status: 'called',
      status_ar: 'تمت المناداة', status_tone: 'success', doctor_name: 'د. ليلى',
    });
    const keys = Object.keys(row).sort();
    assert.deepEqual(keys, [
      'appt_date', 'appt_time', 'doctor_name', 'id',
      'patient_name', 'queue_number', 'status', 'status_ar', 'status_tone',
    ].sort());
  });
});
