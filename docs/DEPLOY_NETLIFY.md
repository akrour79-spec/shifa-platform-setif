# نشر المنصة على Netlify

> المنصة full-stack: Express API + صفحة React? لا — صفحة ثابتة + serverless function.
> لا تنشر الملفات الثابتة فقط، هذا يكتفي بالأوптيون النفسي.

## ما أعددته

- `netlify/functions/api.js` — يغلّف `app` عبر `serverless-http`، ويعيد توجيه المسارات إلى `/api/*`.
- `netlify.toml` — build command + redirects
- `serverless-http` مضاف إلى `dependencies`.

## المتغيرات في Netlify (Site settings → Environment variables)

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | نفس رابط Supabase pooler (`aws-1-`, منفذ 6543) |
| `JWT_SECRET` | مفتاح عشوائي طویل |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://<موقعك>.netlify.app` (مع `www` إن استخدمته) |

## الإعداد بعد الربط مع GitHub

1. Connect repository
2. Build command: `npm install`
3. Publish directory: `.`
4. Functions directory: `netlify/functions`
5. Environment variables (أعلاه)
6. Deploy

ثم اختبر:
- `https://<your-site>.netlify.app/api/health` → `{"status":"online",...}`
- `https://<your-site>.netlify.app/#monetization` → باقات الباقات محمّلة

## تحذيرات

- لا تستخدم Direct connection المنفذ 5432 في Netlify: use Session Pooler 6543.
- إذا رأيت ``A timeout waiting for response``، زد timeout في `netlify.toml`:
```toml
[functions]
  node_bundler = "esbuild"
```
- لا تضع `.env` في GitHub. `netlify.toml` لا يحوي أسرار.
