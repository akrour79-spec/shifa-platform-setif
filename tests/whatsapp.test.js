/**
 * tests/whatsapp.test.js — اختبارات وحدة إرسال WhatsApp
 * ----------------------------------------------------------------------------
 * - تحويل الأرقام الجزائرية إلى الصيغة الدولية
 * - وضع السجل عند غياب الإعدادات (لا يرمي خطأ)
 * - رفض الأرقام/الرسائل الفارغة
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { toInternational, isConfigured, sendWhatsApp } = require('../server/lib/whatsapp');

describe('toInternational — تحويل الأرقام الجزائرية', () => {
  it('رقم يبدأ بـ 0 يُحوَّل إلى 213', () => {
    assert.equal(toInternational('0550123456'), '213550123456');
  });

  it('رقم بصيغة دولية يبقى كما هو', () => {
    assert.equal(toInternational('213550123456'), '213550123456');
  });

  it('رقم فارغ يعيد سلسلة فارغة', () => {
    assert.equal(toInternational(''), '');
    assert.equal(toInternational(null), '');
  });
});

describe('sendWhatsApp — السلوك الآمن', () => {
  it('بدون إعدادات يعمل في وضع السجل ولا يفشل', async () => {
    // isConfigured() false في بيئة الاختبار (لا توجد متغيرات بيئة)
    if (isConfigured()) return; // تخطَّ إن كان مضبوطاً فعلاً
    const res = await sendWhatsApp('0550123456', 'تذكير بموعدك');
    assert.equal(res.ok, true);
    assert.equal(res.provider, 'whatsapp-log');
  });

  it('يرفض الرقم الفارغ', async () => {
    const res = await sendWhatsApp('', 'رسالة');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'missing_phone_or_message');
  });

  it('يرفض الرسالة الفارغة', async () => {
    const res = await sendWhatsApp('0550123456', '');
    assert.equal(res.ok, false);
  });
});
