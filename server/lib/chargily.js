/**
 * lib/chargily.js — وحدة الربط ببوابة الدفع الإلكترونية الجزائرية (Chargily Pay v2)
 * -----------------------------------------------------------------------------
 * تدعم الدفع بالبطاقة الذهبية لبريد الجزائر (Edahabia) وبطاقات CIB البنكية بالدينار (DZD).
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

const CHARGILY_API_BASE = process.env.CHARGILY_MODE === 'live'
  ? 'https://pay.chargily.net/api/v2'
  : 'https://pay.chargily.net/test/api/v2';

const PLAN_PRICES = {
  starter: { monthly: 4900, yearly: 49000, name: 'الباقة الأساسية (Essential)' },
  pro: { monthly: 9900, yearly: 99000, name: 'الباقة الكاملة (Complete)' },
  clinic_enterprise: { monthly: 18900, yearly: 189000, name: 'الباقة المتكاملة (Enterprise)' },
};

/**
 * إنشاء جلسة دفع جديدة عبر Chargily Pay v2
 */
async function createCheckout(options) {
  const {
    doctorId,
    planId,
    billingCycle = 'monthly',
    paymentMethod = 'edahabia',
    successUrl,
    failureUrl,
  } = options;

  const plan = PLAN_PRICES[planId];
  if (!plan) {
    throw new Error('خطة الاشتراك غير معروفة');
  }

  const amount = billingCycle === 'yearly' ? plan.yearly : plan.monthly;
  const apiKey = process.env.CHARGILY_SECRET_KEY;

  let checkoutUrl = '';
  let chargilyCheckoutId = `chk_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  if (apiKey) {
    try {
      const response = await fetch(`${CHARGILY_API_BASE}/checkouts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          currency: 'dzd',
          payment_method: paymentMethod,
          success_url: successUrl || `http://localhost:${config.port}/?payment=success`,
          failure_url: failureUrl || `http://localhost:${config.port}/?payment=failed`,
          metadata: {
            doctor_id: doctorId || null,
            plan_id: planId,
            billing_cycle: billingCycle,
          },
        }),
      });

      const data = await response.json();
      if (response.ok && data.checkout_url) {
        checkoutUrl = data.checkout_url;
        chargilyCheckoutId = data.id || chargilyCheckoutId;
      }
    } catch (err) {
      console.warn('[chargily] تعذّر الاتصال بخادم Chargily الحي، استخدام المحاكاة الآمنة:', err.message);
    }
  }

  // في حالة الوضع التجريبي أو غياب المفتاح الحي، إنتاج رابط محاكاة Chargily التفاعلي
  if (!checkoutUrl) {
    checkoutUrl = `http://localhost:${config.port}/?payment=demo_success&checkout_id=${chargilyCheckoutId}&plan=${planId}&amount=${amount}`;
  }

  // إدراج سجل السداد في قاعدة البيانات
  const record = await db.queryOne(
    `INSERT INTO public.subscriptions_payments
       (doctor_id, chargily_checkout_id, amount, currency, plan_id, billing_cycle, payment_method, status, checkout_url)
     VALUES ($1, $2, $3, 'dzd', $4, $5, $6, 'pending', $7)
     RETURNING id, doctor_id, chargily_checkout_id, amount, currency, plan_id, billing_cycle, payment_method, status, checkout_url, created_at`,
    [doctorId || null, chargilyCheckoutId, amount, planId, billingCycle, paymentMethod, checkoutUrl]
  );

  return {
    paymentRecord: record,
    checkoutUrl,
    planName: plan.name,
    amount,
  };
}

/**
 * الاستعلام عن حالة تخليص مباشرةً من Chargily — مصدر الحقيقة الوحيد
 * قبل اعتبار أي دفع ناجحاً. يُستخدم في الإنتاج حيث لا نثق بإشعار المتصفح.
 * تُرجع { verified, status } — verified=false تعني تعذّر التحقق (لا تُقبل).
 */
async function getCheckoutStatus(checkoutId) {
  const apiKey = process.env.CHARGILY_SECRET_KEY;
  if (!apiKey || !checkoutId) return { verified: false, status: null };

  try {
    const response = await fetch(
      `${CHARGILY_API_BASE}/checkouts/${encodeURIComponent(checkoutId)}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!response.ok) return { verified: false, status: null };
    const data = await response.json();
    return { verified: true, status: data.status || null };
  } catch {
    return { verified: false, status: null };
  }
}

/**
 * التحقق من توقيع الـ Webhook القادم من Chargily
 */
function verifyWebhookSignature(signature, rawBody) {
  const secret = process.env.CHARGILY_WEBHOOK_SECRET || process.env.CHARGILY_SECRET_KEY;
  if (!secret || !signature) return false;

  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch {
    return false;
  }
}

/**
 * معالجة أحداث النجاح للـ Webhook
 */
async function processWebhookEvent(payload) {
  const { event, data } = payload || {};

  if (event === 'checkout.paid' || data?.status === 'paid') {
    const checkoutId = data?.id;
    if (checkoutId) {
      await db.query(
        `UPDATE public.subscriptions_payments
            SET status = 'paid', paid_at = NOW(), raw_payload = $2, updated_at = NOW()
          WHERE chargily_checkout_id = $1`,
        [checkoutId, JSON.stringify(payload)]
      );
      return { success: true, checkoutId, status: 'paid' };
    }
  }

  return { success: false, reason: 'حدث غير معروف أو غير مكتمل' };
}

module.exports = {
  PLAN_PRICES,
  createCheckout,
  getCheckoutStatus,
  verifyWebhookSignature,
  processWebhookEvent,
};
