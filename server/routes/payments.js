/**
 * routes/payments.js — مسارات الدفع الإلكتروني بالبطاقة الذهبية / CIB (Chargily Pay)
 * -----------------------------------------------------------------------------
 */

'use strict';

const express = require('express');
const db = require('../db');
const { optionalAuth, authenticate, asyncHandler } = require('../middleware/auth');
const { AppError } = require('../middleware/errors');
const { createCheckout, verifyWebhookSignature, processWebhookEvent, PLAN_PRICES } = require('../lib/chargily');

const router = express.Router();

/**
 * GET /api/payments/plans — جلب خطط الاشتراكات والأسعار بالدينار
 */
router.get('/plans', (req, res) => {
  res.json({ plans: PLAN_PRICES });
});

/**
 * POST /api/payments/checkout — إنشاء طلب دفع جديد لاشتراك عيادة
 */
router.post('/checkout', optionalAuth, asyncHandler(async (req, res) => {
  const { planId, billingCycle = 'monthly', paymentMethod = 'edahabia' } = req.body || {};

  if (!planId || !PLAN_PRICES[planId]) {
    throw AppError.badRequest('خطة الاشتراك المختارة غير ممتدة أو غير صالحة');
  }

  let doctorId = null;
  if (req.user) {
    const doctor = await db.queryOne('SELECT id FROM public.doctors WHERE profile_id = $1', [req.user.id]);
    if (doctor) doctorId = doctor.id;
  }

  const result = await createCheckout({
    doctorId,
    planId,
    billingCycle,
    paymentMethod,
  });

  res.status(201).json({
    message: 'تم إنشاء جلسة التخليص المالي بنجاح',
    ...result,
  });
}));

/**
 * POST /api/payments/webhook — استقبال إشعار الخادم المباشر من Chargily
 */
router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const signature = req.headers['chargily-signature'];
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  // التحقق اختياري في البيئة المحلية، وإجباري عند وجود التوقيع
  if (signature && !verifyWebhookSignature(signature, rawBody)) {
    throw new AppError(401, 'invalid_signature', 'توقيع Chargily غير صالح');
  }

  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const result = await processWebhookEvent(payload);

  res.json({ received: true, result });
}));

/**
 * POST /api/payments/confirm-demo — تأكيد نجاح الدفع التجريبي (Demo Payment Success)
 */
router.post('/confirm-demo', asyncHandler(async (req, res) => {
  const { checkoutId } = req.body || {};

  if (!checkoutId) {
    throw AppError.badRequest('معرّف التخليص مطلوب (checkoutId)');
  }

  const updated = await db.queryOne(
    `UPDATE public.subscriptions_payments
        SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE chargily_checkout_id = $1
      RETURNING id, doctor_id, chargily_checkout_id, amount, plan_id, billing_cycle, status, paid_at`,
    [checkoutId]
  );

  if (!updated) {
    throw AppError.notFound('سجل التخليص المالي غير موجود');
  }

  res.json({
    message: 'تم تأكيد عملية الدفع التجريبية بنجاح بنظام Chargily',
    payment: updated,
  });
}));

/**
 * GET /api/payments/history — سجل المدفوعات للعيادة أو Admin
 */
router.get('/history', authenticate, asyncHandler(async (req, res) => {
  let rows = [];
  const doctor = await db.queryOne('SELECT id FROM public.doctors WHERE profile_id = $1', [req.user.id]);

  if (doctor) {
    rows = await db.query(
      `SELECT id, amount, currency, plan_id, billing_cycle, payment_method, status, paid_at, created_at
         FROM public.subscriptions_payments
        WHERE doctor_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [doctor.id]
    );
  } else if (req.user.role === 'admin') {
    rows = await db.query(
      `SELECT p.id, p.doctor_id, p.amount, p.currency, p.plan_id, p.billing_cycle, p.payment_method, p.status, p.paid_at, p.created_at,
              d.name AS doctor_name
         FROM public.subscriptions_payments p
         LEFT JOIN public.doctors d ON d.id = p.doctor_id
        ORDER BY p.created_at DESC LIMIT 50`
    );
  }

  res.json({ history: rows });
}));

module.exports = router;
