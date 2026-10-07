# دليل التشغيل — منصة شفاء (Full-Stack)

> هذه الوثيقة تشرح تشغيل النسخة الخلفية (Backend) الحقيقية.
> راجع `docs/CHANGELOG_SECURITY.md` لتعرف ما تغيّر ولماذا.

---

## المتطلبات

| الأداة | الإصدار | الحالة |
|---|---|---|
| Node.js | 20 أو أحدث (لدينا 24) | ✅ مثبّت |
| npm | 10 أو أحدث | ✅ |
| Supabase | مشروع مجاني | ⚠️ تحتاج ربط مشروعك |

لا تحتاج Docker ولا PostgreSQL مثبّت محلياً — كل شيء يعمل عبر Supabase.

---

## الخطوات (بالترتيب)

### 1) إنشاء ملف البيئة

```powershell
copy .env.example .env
```

### 2) الحصول على رابط الاتصال من Supabase

من لوحة Supabase:

1. افتح مشروعك
2. `Project Settings` ← `Database`
3. في قسم `Connection string` اختر نمط **URI**
4. اختر **Session Pooler** (المنفذ `6543`) وليس Direct connection
5. اضغط Reveal ونسخ الرابط

ستحصل على رابط بهذا الشكل:

```
postgresql://postgres.<project-ref>:<PASSWORD>@aws-1-<region>.pooler.supabase.com:6543/postgres
```

> **مهم:** استبدل `[YOUR-PASSWORD]` بكلمة المرور الحقيقية، وضع الرابط في `.env` فقط.

### 3) توليد مفتاح الجلسات

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

انسخ الناتج إلى `JWT_SECRET` في `.env`.

### 4) تثبيت الحزم

```powershell
npm install
```

### 5) إنشاء الجداول

```powershell
npm run migrate
```

ماذا يفعل هذا:
- `000_drop_legacy.sql` — يحذف الجدول القديم المفتوح الذي كان فيه تسريب بيانات
- `001_schema.sql` — ينشئ الجداول والفهارس وقيود منع الحجز المزدوج
- `002_security_lockdown.sql` — **يغلق الوصول العام لقاعدة البيانات**

### 6) تعبئة البيانات

```powershell
npm run seed
```

يملأ البلديات (6) والتخصصات (10) والأطباء (8)، وينشئ حسابين تجريبيين.

### 7) التشغيل

```powershell
npm start
```

افتح: **http://localhost:4000**

تحقق من صحة الاتصال: **http://localhost:4000/api/health**

---

## الحسابات التجريبية

| الدور | الهاتف | كلمة السر |
|---|---|---|
| طبيب | `0661223344` | `Shifa2026!` |
| مريض | `0661998877` | `Shifa2026!` |

أو استخدم زر الدخول السريع في نافذة تسجيل الدخول.

> طبيب جديد لا يمكنه الدخول لطابوره حتى تعتمد عيادته:
> `npm run approve-clinic -- list` ثم `npm run approve-clinic -- <رقم-هاتفه> --yes`.

> ⚠️ هذه الحسابات لا تُنشأ في الإنتاج (`NODE_ENV=production`) إطلاقاً.

---

## الاختبارات

```powershell
npm test
```

56 اختباراً: منطق خالص + فحوص تماسك بنيوية (لا تحتاج قاعدة بيانات).
الخانات، انتقالات الحالات، ومنع حقن SQL وXSS.

---

## واجهات API

### المصادقة

| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/api/auth/signup` | إنشاء حساب |
| POST | `/api/auth/login` | تسجيل الدخول |
| GET | `/api/auth/me` | الملف الشخصي |
| PATCH | `/api/auth/me` | تحديث الملف |
| POST | `/api/auth/change-password` | تغيير كلمة السر |

### الأطباء (قراءة عامة)

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/doctors/meta` | البلديات والتخصصات |
| GET | `/api/doctors` | قائمة مع فلاتر وترقيم |
| GET | `/api/doctors/:id` | ملف طبيب |
| GET | `/api/doctors/:id/availability?date=` | الخانات المتاحة |
| GET | `/api/doctors/:id/days` | الأيام المتاحة |
| PUT | `/api/doctors/me` | تحديث بيانات العيادة (طبيب فقط) |

### المواعيد

| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/api/appointments` | حجز موعد |
| GET | `/api/appointments?scope=mine` | مواعيدي |
| GET | `/api/appointments?scope=doctor` | مواعيد العيادة |
| GET | `/api/appointments/:id` | موعد واحد |
| PATCH | `/api/appointments/:id/status` | تغيير الحالة |

### الطابور

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/queue/screen?doctorId=` | شاشة العرض (بدون دخول) |
| GET | `/api/queue` | طابور العيادة |
| POST | `/api/queue/call-next` | استدعاء التالي |
| POST | `/api/queue/call/:id` | استدعاء مريض محدد |
| POST | `/api/queue/complete/:id` | إنهاء معاينة |
| POST | `/api/queue/walk-in` | مريض عابر |
| DELETE | `/api/queue/:id` | إلغاء موعد |

---

## نموذج النشر على Vercel

`vercel.json` الحالي ينشر ملفات ثابتة فقط، وهذا **لا يكفي** — الخادم
express غير مُعدَّت بعد لـ Serverless. المطلوب:

1. تحويل `server/index.js` ليصدّر `app` (وهو يفعل ذلك بالفعل ✓)
2. إضافة `api/index.js`:
   ```javascript
   const { app } = require('../server/index.js');
   module.exports = app;
   ```
3. في إعدادات Vercel أضف المتغيرات:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `NODE_ENV=production`
   - `CORS_ORIGIN=https://your-domain.dz`

> البديل الأسهل: أي استضافة تدعم Node.js كاملاً (Railway، Render، VPS).
> لوحة تحكم الطابور وعمليات الكتابة المتكررة تناسب هذا أفضل من Serverless.

---

## ملاحظات أمنية مهمة

1. **لا تضع `DATABASE_URL` أو `JWT_SECRET` في أي ملف يُنشر للمتصفح.**
   الخادم يرفض الإقلاع بدونهما، والملفات محميّة من الخدمة الثابتة.

2. **مفتاح Supabase `anon` لم يعد له أي فائدة** — لأن `002_security_lockdown.sql`
   ألغى صلاحية `anon` على كل الجداول. لا تعِده.

3. **غيّر كلمة مرور قاعدة البيانات** إذا نُشر `DATABASE_URL` بالخطأ.

4. **لا يُطلب من المستخدم رقم CVV أبداً.** عند تفعيل الدفع ستتم العملية في
   صفحة مستضافة من Chargily.

5. في الإنتاج: `CORS_ORIGIN` بنطاق محدد، و`NODE_ENV=production` إلزامي.

---

## حل المشاكل

**"تعذّر إقلاع الخادم — إعدادات ناقصة"**
→ راجع `.env`. تأكد من `DATABASE_URL` و`JWT_SECRET`.

**"فشل الاتصال: getaddrinfo ENOTFOUND"**
→ رابط الاتصال خاطئ. تحقق من اسم المضيف والمنفذ.

**"SECURITY FAILURE: anon لا يزال يملك صلاحية SELECT"**
→ مشروعك له إعدادات قديمة. شغّل الترحيلات مجدداً، أو راجع صلاحيات
المشروع من لوحة Supabase.

**الجداول غير موجودة بعد `npm run migrate`**
→ الـ Pooler في وضع Transaction لا ينشئ الجداول بشكل دائم في بعض
الإعدادات. جرّب رابط **Direct connection** (المنفذ 5432) للترحيل مرة واحدة.

**`npm` لا يعمل في PowerShell**
→ استخدم `npm.cmd` بدل `npm`:
```powershell
npm.cmd install
```