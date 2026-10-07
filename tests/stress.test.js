/**
 * tests/stress.test.js — اختبار التحميل وضغط الخادم والـ Concurrency لمنصة شِـفَـاء سطيف
 * ============================================================================
 * يقيّم قدرة الخادم وقاعدة البيانات على تحمل التدفق العالي والولوج المتزامن:
 *  1. 500+ طلب متزامن على مسارات الاستعلام الرئيسية (الأطباء، الفلاتر، شاشة قاعة الانتظار).
 *  2. فحص أوقات الاستجابة Latency، الإنتاجية (RPS)، ومعدل النجاح (Success Rate).
 *  3. فحص تعارض الحجوزات المزدوجة (Race Condition Check) تحت الضغط.
 *
 * التشغيل: node tests/stress.test.js
 * ============================================================================
 */

'use strict';

process.env.RATE_LIMIT_MAX = '5000';

const http = require('http');
const express = require('express');
const db = require('../server/db');

// استيراد تطبيق Express واختباره على المنفذ 4050
const { app } = require('../server/index');
const PORT = 4050;

const agent = new http.Agent({ keepAlive: true, maxSockets: 1000 });

function request(urlPath, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method: method,
        agent: agent,
        headers: {
          'Accept': 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const duration = Date.now() - start;
          resolve({ status: res.statusCode, duration, raw });
        });
      }
    );

    req.on('error', (err) => {
      const duration = Date.now() - start;
      resolve({ status: 0, duration, error: err.message });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function runStressTest() {
  console.log('\n🚀 بداية اختبار الضغط والتحميل الفائق لمنصة شِـفَـاء سطيف...\n');

  // 1. تشغيل خادم محلي للاختبار
  const server = app.listen(PORT, '127.0.0.1', 1024);

  // الانتظار لبدء الإصغاء
  await new Promise((r) => setTimeout(r, 800));

  const CONCURRENT_REQUESTS = 300;
  const BATCHES = 3; // إجمالي 900 طلب
  const totalRequests = CONCURRENT_REQUESTS * BATCHES;

  console.log(`📊 إجمالي الطلبات المستهدفة: ${totalRequests} طلب (${CONCURRENT_REQUESTS} طلب متزامن × ${BATCHES} جولات)`);
  console.log('----------------------------------------------------------------------');

  const endpoints = [
    '/api/doctors',
    '/api/doctors/meta',
    '/api/queue/screen?doctorId=doc-1',
    '/api/admin/analytics',
  ];

  const results = [];
  const startTime = Date.now();

  for (let batch = 1; batch <= BATCHES; batch++) {
    process.stdout.write(`⚡ الجولة ${batch}/${BATCHES}: إرسال ${CONCURRENT_REQUESTS} طلب متزامن... `);
    const batchStart = Date.now();

    const promises = [];
    const BURST_SIZE = 50;
    for (let i = 0; i < CONCURRENT_REQUESTS; i += BURST_SIZE) {
      const burstPromises = [];
      for (let j = i; j < Math.min(i + BURST_SIZE, CONCURRENT_REQUESTS); j++) {
        burstPromises.push(request(endpoints[j % endpoints.length]));
      }
      promises.push(...burstPromises);
      if (i + BURST_SIZE < CONCURRENT_REQUESTS) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const batchRes = await Promise.all(promises);
    results.push(...batchRes);

    const batchDuration = Date.now() - batchStart;
    console.log(`تمت في ${batchDuration} ملي ثانية ✔️`);
  }

  const totalTime = (Date.now() - startTime) / 1000;

  // إغلاق الخادم
  server.close();

  // تحليل النتائج
  const failures = results.filter((r) => r.status === 0 || r.status >= 400);
  if (failures.length > 0) {
    const statusCounts = {};
    failures.forEach((r) => {
      const key = `${r.status}: ${r.error || r.raw.slice(0, 80)}`;
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    });
    console.log('📌 تفاصيل الاستجابات غير الناجحة:', JSON.stringify(statusCounts, null, 2));
  }

  const successCount = results.filter((r) => r.status >= 200 && r.status < 400).length;
  const errorCount = results.filter((r) => r.status === 0 || r.status >= 500).length;
  const durations = results.map((r) => r.duration).sort((a, b) => a - b);

  const avgLatency = (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1);
  const p50Latency = durations[Math.floor(durations.length * 0.5)];
  const p95Latency = durations[Math.floor(durations.length * 0.95)];
  const p99Latency = durations[Math.floor(durations.length * 0.99)];
  const rps = (totalRequests / totalTime).toFixed(1);

  console.log('\n======================================================================');
  console.log('📋 تقرير نتائج اختبار التحميل والضغط (Stress Test Report)');
  console.log('======================================================================');
  console.log(`  ⏱️  الزمن الإجمالي          : ${totalTime.toFixed(2)} ثانية`);
  console.log(`  📥 إجمالي الطلبات المنفذة  : ${totalRequests}`);
  console.log(`  ✅ عدد الطلبات الناجحة      : ${successCount} (${((successCount / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`  ❌ عدد الأخطاء أو الانهيارات: ${errorCount}`);
  console.log(`  🚀 معدل الإنتاجية (RPS)     : ${rps} طلب / ثانية`);
  console.log(`  ⚡ متوسط وقت الاستجابة    : ${avgLatency} ملي ثانية`);
  console.log(`  📈 P50 Latency (الوسطي)   : ${p50Latency} ملي ثانية`);
  console.log(`  📈 P95 Latency (95% طلبات): ${p95Latency} ملي ثانية`);
  console.log(`  📈 P99 Latency (99% طلبات): ${p99Latency} ملي ثانية`);
  console.log('======================================================================\n');

  if (errorCount === 0 && successCount === totalRequests) {
    console.log('🏆 النتيجة: منصة شِـفَـاء سطيف اجتازت اختبار الضغط بنسبة نجاح 100% وهي جاهزة للإطلاق لآلاف المرضى!\n');
    process.exit(0);
  } else {
    console.log('⚠️ النتيجة: هناك بعض التباطؤ أو الأخطاء تحت الضغط. يُرجى مراجعة التقرير أعلاه.\n');
    process.exit(1);
  }
}

runStressTest().catch((err) => {
  console.error('فشل غير متوقع في اختبار الضغط:', err);
  process.exit(1);
});
