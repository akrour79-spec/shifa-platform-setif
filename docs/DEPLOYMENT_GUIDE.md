# 🚀 دليل النشر السحابي والتشغيل الإنتاجي — منصة شِـفَـاء سطيف

يوفر هذا الدليل الخطوات الكاملة والاحترافية لنشر منصة **شِـفَـاء سطيف** على السحابة السريعة وتوفير أعلى معايير الأمان والأداء للمرضى والعيادات في ولاية سطيف.

---

## 📋 1. متطلبات البيئة الإنتاجية (Production Environment Variables)

قبل النشر على أي استضافة سحابية، يجب ضبط المتغيرات التالية في لوحة التحكم (Environment Variables):

| اسم المتغير | الوصف | مثال قيم إنتاجية |
| :--- | :--- | :--- |
| `NODE_ENV` | بيئة التشغيل | `production` |
| `PORT` | منفذ الخادم | `4000` |
| `DATABASE_URL` | رابط Supabase PostgreSQL Pooler | `postgres://postgres.ref:pass@aws-1-eu-central-1.pooler.supabase.com:6543/postgres` |
| `JWT_SECRET` | مفتاح تشفير التوكن (32+ حرف) | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CHARGILY_SECRET_KEY` | مفتاح Chargily Pay المباشر | `secret_live_xxxxxxxxxxxxxxxx` |
| `CHARGILY_MODE` | وضع بوابة الدفع | `live` (أو `test` للتجربة) |
| `CHARGILY_WEBHOOK_SECRET` | سر الـ Webhook للتحقق من التوقيع | `secret_wh_xxxxxxxxxxxxxxxx` |
| `CORS_ORIGIN` | النطاقات المسموحة للـ API | `https://shifa-setif.dz,https://www.shifa-setif.dz` |

---

## ☁️ 2. خيارات النشر السحابي (Deployment Options)

### الخيار الأول: النشر المباشر عبر Render (الموصى به للأداء وسهولة الربط)
1. افتح حساباً مجانياً على **[Render.com](https://render.com/)**.
2. اضغط **New > Web Service** واربط مستودع الكود (GitHub).
3. اختر اسم التطبيق `shifa-setif` والبيئة `Node`.
4. انسخ المتغيرات من الجدول أعلاه وضبطها في قسم **Environment Variables**.
5. سيبدأ النشر التلقائي فوراً وستحصل على رابط HTTPS مجاني ومؤمن.

### الخيار الثاني: النشر عبر Docker على سيرفر خاص (VPS / Hetzner / DigitalOcean)
إذا أردت استضافة التطبيق على خادم خاص في الجزائر أو أوروبا:

```bash
# 1) استنسخ المشروع على السيرفر
git clone https://github.com/akrour79-spec/shifa-platform-setif.git
cd shifa-platform-setif

# 2) أنشئ ملف .env الإنتاجي وضبط المفاتيح
cp .env.example .env
nano .env

# 3) شَغّل الحاوية بواسطة Docker Compose
docker-compose up -d --build

# 4) الفحص والتحقق
docker-compose ps
curl http://localhost:4000/api/health
```

### الخيار الثالث: النشر على Vercel Serverless
1. سجّل على **[Vercel.com](https://vercel.com)** وضف المشروع.
2. يتم قراءة ملف [`vercel.json`](file:///c:/Users/dell/.gemini/antigravity/scratch/shifa-platform/vercel.json) المرفق تلقائياً لتحويل Express API إلى Serverless Functions.
3. ضع المتغيرات في قسم **Project Settings > Environment Variables**.

---

## 🔒 3. قائمة الفحص قبل إطلاق الخدمة للمرضى (Production Safety Checklist)

- [x] تشغيل كل الاختبارات البرمجية التأكيدية: `node tests/wiring.test.js; node tests/unit.test.js` (60/60 نجاح).
- [ ] تدوير مفاتيح قاعدة البيانات Supabase وتحديث كلمة المرور.
- [ ] تغيير `JWT_SECRET` بقيمة عشوائية مشفرة لا تقل عن 64 حرفاً.
- [ ] التأكد من وضع `NODE_ENV=production`.
- [ ] تفعيل `CHARGILY_MODE=live` ووضع المفتاح المعتمد من منصة Chargily Pay.
- [ ] ربط شهادة الأمان SSL (HTTPS) وتوجيه النطاق الوطني (مثل `shifa-setif.dz`).

---

## 💾 4. النسخ الاحتياطي لقاعدة البيانات (Automated DB Backups)

في قاعدة Supabase، يتم أخذ نسخ احتياطية تلقائية يومية.
لأخذ نسخة احتياطية يدوية في أي وقت من السيرفر:

```bash
pg_dump "DATABASE_URL" --clean --if-exists -f backup_shifa_setif_$(date +%F).sql
```
