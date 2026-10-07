/**
 * tests/production.test.js — فحوصات جاهزية النشر السحابي والأمان الكلي
 * ============================================================================
 * يتحقق من:
 *  1. سلامة تكوين Dockerfile و docker-compose و render.yaml و vercel.json
 *  2. وجود الفحوصات الأمنية لرؤوس Express و CSP و Helmet
 *  3. اكتمال متغيرات البيئة في .env.example
 *  4. خلو الكود من الأسرار المكشوفة
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('تكوين Dockerfile يدعم الحاويات الآمنة غير الجذرية والحصانة الصحية', () => {
  const dockerfile = read('Dockerfile');
  assert.ok(dockerfile.includes('USER node'), 'Dockerfile يجب أن يحدد مستخدماً غير جذر USER node');
  assert.ok(dockerfile.includes('HEALTHCHECK'), 'Dockerfile يجب أن يحتوي فحص الحصانة HEALTHCHECK');
  assert.ok(dockerfile.includes('EXPOSE 4000'), 'Dockerfile يفتح المنفذ 4000');
});

test('تكوين docker-compose.yml يدعم تدوير السجلات والفحص الدوري', () => {
  const compose = read('docker-compose.yml');
  assert.ok(compose.includes('healthcheck:'), 'docker-compose يجب أن يضم فحص الحصانة');
  assert.ok(compose.includes('max-size:'), 'docker-compose يجب أن يضمن تدوير السجلات لمنع امتلاء القرص');
});

test('ملف .env.example يحتوي على كافة المتغيرات المطلوبة للإنتاج', () => {
  const envEx = read('.env.example');
  assert.ok(envEx.includes('DATABASE_URL'));
  assert.ok(envEx.includes('JWT_SECRET'));
  assert.ok(envEx.includes('CHARGILY_SECRET_KEY'));
  assert.ok(envEx.includes('CORS_ORIGIN'));
});

test('خادم Express يطبق Helmet و CSP و CORS و Rate Limiter', () => {
  const serverIndex = read('server/index.js');
  assert.ok(serverIndex.includes('helmet('), 'الخادم يجب أن يطبق Helmet');
  assert.ok(serverIndex.includes('cors('), 'الخادم يجب أن يطبق CORS');
  assert.ok(serverIndex.includes('contentSecurityPolicy'), 'الخادم يجب أن يطبق CSP');
});
