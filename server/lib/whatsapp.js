/**
 * server/lib/whatsapp.js — إرسال WhatsApp حقيقي عبر Meta Cloud API
 * -----------------------------------------------------------------------------
 * - إن كانت متغيرات البيئة مضبوطة (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)
 *   يُرسل فعلياً عبر WhatsApp Cloud API.
 * - وإلا يعمل في "وضع السجل" (log mode): يسجّل الرسالة بدل إرسالها،
 *   حتى لا تنكسر المنصة في التطوير/الاختبار.
 *
 * الصيغة الدولية: الأرقام الجزائرية تُحوَّل إلى 213XXXXXXXXX.
 */

'use strict';

const { toNationalDigits, ALGERIA_CC } = require('./phone');

const TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v18.0';

function isConfigured() {
  return Boolean(TOKEN && PHONE_NUMBER_ID);
}

/** تحويل رقم جزائري إلى الصيغة الدولية بدون + */
function toInternational(phone) {
  const digits = toNationalDigits(String(phone || ''));
  if (digits.startsWith('0')) return `${ALGERIA_CC}${digits.slice(1)}`;
  if (digits.startsWith(ALGERIA_CC)) return digits;
  return digits;
}

/**
 * إرسال رسالة نصية عبر WhatsApp.
 * @returns {Promise<{ok: boolean, provider: string, messageId?: string, error?: string}>}
 */
async function sendWhatsApp(phone, message) {
  const to = toInternational(phone);

  if (!to || !message) {
    return { ok: false, provider: 'whatsapp', error: 'missing_phone_or_message' };
  }

  // وضع السجل — بلا إعدادات لا نحاول الاتصال بـ Meta
  if (!isConfigured()) {
    console.log(`[whatsapp:log-mode] → ${to}: ${String(message).slice(0, 80)}…`);
    return { ok: true, provider: 'whatsapp-log', messageId: `log-${Date.now()}` };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = data?.error?.message || `http_${res.status}`;
      return { ok: false, provider: 'whatsapp-cloud', error: errMsg };
    }

    const messageId = data?.messages?.[0]?.id || null;
    return { ok: true, provider: 'whatsapp-cloud', messageId };
  } catch (err) {
    return { ok: false, provider: 'whatsapp-cloud', error: err.message };
  }
}

module.exports = { sendWhatsApp, isConfigured, toInternational };
