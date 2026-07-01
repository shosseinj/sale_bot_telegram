# دستیار فروش و پرداخت تلگرام روی Cloudflare Workers

این پروژه یک MVP آماده برای فروش خدمات/محصول در تلگرام است که بدون VPS اجرا می‌شود:

- Cloudflare Worker برای API و وبهوک تلگرام
- Cloudflare D1 برای دیتابیس
- پنل مدیریت فارسی داخل خود Worker روی مسیر `/admin`
- ورود محصولات از CSV خروجی Excel
- FAQ و پاسخ هوشمند با Workers AI، در صورت فعال بودن
- ثبت سفارش از داخل ربات با عبارت `خرید کد محصول`
- فاکتور آنلاین برای هر سفارش روی مسیر `/invoice/{ORDER_CODE}`
- روش پرداخت دستی/لینک پرداخت از داخل تنظیمات پنل
- ثبت اعلام پرداخت/رسید توسط مشتری و مدیریت وضعیت پرداخت در پنل

> نکته امنیتی: هیچ توکن واقعی را داخل فایل‌های پروژه ذخیره نکنید. توکن‌ها باید با `wrangler secret put` ثبت شوند.

---

## 1. پیش‌نیازها

روی سیستم خود نصب داشته باشید:

```powershell
node -v
npm -v
```

اگر Node نصب نیست، نسخه LTS را نصب کنید.

---

## 2. آماده‌سازی پروژه

```powershell
cd worker
npm install
Copy-Item wrangler.toml.example wrangler.toml
Copy-Item .dev.vars.example .dev.vars
```

در Linux/Mac:

```bash
cd worker
npm install
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
```

---

## 3. ساخت توکن‌ها

### 3.1. توکن ربات تلگرام

در تلگرام به `@BotFather` پیام بدهید:

```text
/newbot
```

توکن ربات را نگه دارید. آن را داخل چت یا GitHub عمومی منتشر نکنید.

### 3.2. ساخت ADMIN_TOKEN و TELEGRAM_WEBHOOK_SECRET

```powershell
node -e "console.log(crypto.randomUUID() + '-' + crypto.randomUUID())"
```

این دستور را دو بار بزنید:

- یک خروجی برای `ADMIN_TOKEN`
- یک خروجی برای `TELEGRAM_WEBHOOK_SECRET`

---

## 4. اجرای local

داخل `worker/.dev.vars` فقط برای local مقدار بدهید:

```env
ADMIN_TOKEN=توکن_ادمین_خودت
TELEGRAM_BOT_TOKEN=توکن_بات_از_BotFather
TELEGRAM_WEBHOOK_SECRET=سکرت_وبهوک_خودت
```

Migration محلی:

```powershell
npm run d1:local
npm run dev
```

پنل local:

```text
http://localhost:8787/admin
```

اگر پنل را جدا خواستید:

```powershell
cd ..\panel
python -m http.server 8788
```

و باز کنید:

```text
http://localhost:8788
```

---

## 5. ساخت D1 روی Cloudflare

```powershell
npx wrangler login
npx wrangler d1 create ai_sales_assistant
```

خروجی `database_id` را داخل `worker/wrangler.toml` جایگزین کنید:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ai_sales_assistant"
database_id = "DATABASE_ID_FROM_CLOUDFLARE"
```

> binding باید `DB` بماند، چون کد از `env.DB` استفاده می‌کند.

---

## 6. اجرای migration روی Cloudflare

```powershell
npm run d1:remote
```

اگر نسخه قبلی پروژه را قبلاً deploy کرده‌اید، migration جدید `0002_orders_payment_flow.sql` را هم با همین دستور اجرا کنید.

---

## 7. ثبت Secretها روی Cloudflare

```powershell
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

بعد از هر دستور، مقدار را paste کنید و Enter بزنید.

---

## 8. Deploy Worker

```powershell
npm run deploy
```

بعد از deploy، URL شبیه این می‌گیرید:

```text
https://ai-sales-assistant-worker.YOUR_USERNAME.workers.dev
```

پنل آنلاین:

```text
https://ai-sales-assistant-worker.YOUR_USERNAME.workers.dev/admin
```

---

## 9. تنظیم Webhook تلگرام بدون دسترسی مستقیم به Telegram API

اگر `api.telegram.org` روی سیستم شما فیلتر است، از داخل پنل استفاده کنید:

1. پنل را باز کنید: `/admin`
2. Worker API و ADMIN_TOKEN را وارد کنید.
3. روی «تنظیم وبهوک تلگرام» کلیک کنید.
4. با «بررسی وضعیت وبهوک» نتیجه را چک کنید.

این endpointها در Worker وجود دارند:

```text
POST /api/admin/telegram/set-webhook
GET  /api/admin/telegram/webhook-info
```

---

## 10. ورود محصول از CSV

ستون‌های CSV باید دقیقاً این‌ها باشند:

```csv
sku,name,category,price,stock,description
```

نمونه:

```csv
sku,name,category,price,stock,description
MOB-001,گوشی سامسونگ Galaxy A55,موبایل,18500000,7,حافظه ۲۵۶ گیگ و گارانتی
SRV-001,مشاوره طراحی ربات تلگرام,خدمات,3500000,99,طراحی و راه‌اندازی ربات فروش
```

داخل پنل از بخش محصولات فایل را import کنید.

---

## 11. تنظیم پرداخت

در پنل، بخش «تنظیمات ربات» این موارد را وارد کنید:

- شماره کارت
- شماره شبا
- نام صاحب حساب
- لینک پرداخت، اگر دارید
- توضیح ارسال/تحویل
- پیشوند کد سفارش، مثل `SB`

ربات بعد از ثبت سفارش فاکتور می‌سازد و روش پرداخت را به مشتری می‌دهد.

---

## 12. سناریوی فروش در ربات

مشتری در تلگرام می‌زند:

```text
/start
محصولات
خرید MOB-001 تعداد ۲ 09120000000
```

ربات این کارها را انجام می‌دهد:

1. سفارش را در D1 ثبت می‌کند.
2. کد سفارش می‌سازد.
3. فاکتور آنلاین می‌دهد.
4. روش پرداخت را نمایش می‌دهد.
5. بعد از ارسال «پرداخت شد + کد سفارش» یا فیش، وضعیت پرداخت را `reported` می‌کند.

ادمین در پنل می‌تواند پرداخت را تایید کند.

---

## 13. دستورهای کنترل کیفیت

```powershell
cd worker
npm run build:panel
npm run check
```

---

## 14. خطاهای رایج

### 401 Unauthorized

ADMIN_TOKEN پنل با Secret ثبت‌شده یکی نیست.

### Invalid uuid در D1

داخل `wrangler.toml` هنوز مقدار `PASTE_D1_DATABASE_ID_HERE` باقی مانده است.

### ربات جواب نمی‌دهد

این‌ها را چک کنید:

```powershell
npx wrangler tail
```

و از پنل «بررسی وضعیت وبهوک» را بزنید.

### پنل Pages باز نمی‌شود

نیازی به Pages نیست. پنل از خود Worker روی `/admin` سرو می‌شود.

---

## 15. مناسب برای فروش به مشتری

پیشنهاد متن فروش:

```text
ربات فروش و پشتیبانی تلگرام آماده دارم؛ بدون نیاز به سرور، با پنل مدیریت فارسی، ورود محصولات از اکسل، ثبت سفارش، فاکتور آنلاین، پیگیری پرداخت و گزارش سفارش‌ها.
```
