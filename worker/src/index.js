import { PANEL_APP_JS, PANEL_CSS, PANEL_HTML } from "./panel-assets.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
  "access-control-max-age": "86400",
};

const DEFAULT_SETTINGS = {
  shop_name: "دستیار فروش هوشمند",
  welcome_message:
    "سلام، به فروشگاه ما خوش آمدید. نام محصول یا سوال خود را بنویسید. برای خرید، عبارت «خرید + کد محصول» را ارسال کنید؛ مثال: خرید MOB-001",
  operator_message:
    "پیام شما ثبت شد و اپراتور در اولین فرصت بررسی می‌کند. لطفا اگر شماره تماس یا نام محصول مدنظر را ننوشته‌اید، همینجا ارسال کنید.",
  currency: "تومان",
  business_hours: "هر روز ۹ تا ۲۱",
  support_phone: "",
  payment_card: "",
  payment_iban: "",
  payment_account_name: "",
  payment_link: "",
  delivery_info: "ارسال پس از تایید پرداخت هماهنگ می‌شود.",
  order_prefix: "SB",
};

const PRODUCT_COLUMNS = ["sku", "name", "category", "price", "stock", "description"];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extraHeaders },
  });
}

function text(body, status = 200, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType, ...CORS_HEADERS, ...extraHeaders },
  });
}

function serveAdminPanel(pathname) {
  if (pathname === "/admin" || pathname === "/admin/") {
    const html = PANEL_HTML
      .replace('href="assets/style.css"', 'href="/admin/assets/style.css"')
      .replace('src="assets/app.js"', 'src="/admin/assets/app.js"');
    return text(html, 200, "text/html; charset=utf-8");
  }

  if (pathname === "/admin/assets/style.css") {
    return text(PANEL_CSS, 200, "text/css; charset=utf-8", {
      "cache-control": "public, max-age=300",
    });
  }

  if (pathname === "/admin/assets/app.js") {
    return text(PANEL_APP_JS, 200, "application/javascript; charset=utf-8", {
      "cache-control": "public, max-age=300",
    });
  }

  return null;
}

function fail(error, status = 400, details = undefined) {
  return json({ ok: false, error, ...(details ? { details } : {}) }, status);
}

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeDigits(value) {
  return clean(value)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function normalizeFa(value) {
  return normalizeDigits(value)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function escapeLike(value) {
  return normalizeFa(value).replace(/[\\%_]/g, "\\$&");
}

function toNumber(value) {
  const cleaned = normalizeDigits(value).replace(/[,،\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function formatMoney(value, currency = "تومان") {
  const n = Number(value || 0);
  return `${new Intl.NumberFormat("fa-IR").format(Number.isFinite(n) ? n : 0)} ${currency}`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function parseLimitOffset(url) {
  return {
    limit: Math.min(Math.max(Number(url.searchParams.get("limit") || 60), 1), 200),
    offset: Math.max(Number(url.searchParams.get("offset") || 0), 0),
    q: clean(url.searchParams.get("q")),
  };
}

function requireDb(env) {
  if (!env.DB) throw new Error("D1 binding DB تنظیم نشده است.");
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return fail("ADMIN_TOKEN روی Worker تنظیم نشده است. مقدار را فقط با Secret تنظیم کنید.", 500);
  }
  const got = request.headers.get("authorization") || "";
  if (got !== `Bearer ${env.ADMIN_TOKEN}`) {
    return fail("دسترسی غیرمجاز است. توکن مدیریت را بررسی کنید.", 401);
  }
  return null;
}

async function ensureSettings(env) {
  const ts = nowIso();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES(?1, ?2, ?3)",
    ).bind(key, value, ts).run();
  }
}

async function getSettings(env) {
  await ensureSettings(env);
  const rows = await env.DB.prepare("SELECT key, value FROM settings ORDER BY key").all();
  return Object.fromEntries((rows.results || []).map((row) => [row.key, row.value]));
}

async function upsertCustomer(env, from, chatId) {
  const telegramId = String(from?.id || chatId || "");
  const firstName = clean(from?.first_name);
  const lastName = clean(from?.last_name);
  const fullName = clean(`${firstName} ${lastName}`) || "کاربر تلگرام";
  const username = clean(from?.username);
  const ts = nowIso();

  await env.DB.prepare(`
    INSERT INTO customers(telegram_id, full_name, username, created_at, updated_at)
    VALUES(?1, ?2, ?3, ?4, ?4)
    ON CONFLICT(telegram_id) DO UPDATE SET
      full_name = excluded.full_name,
      username = excluded.username,
      updated_at = excluded.updated_at
  `).bind(telegramId, fullName, username, ts).run();

  return await env.DB.prepare("SELECT * FROM customers WHERE telegram_id = ?1")
    .bind(telegramId)
    .first();
}

async function saveMessage(env, customerId, direction, body, meta = {}) {
  await env.DB.prepare(`
    INSERT INTO messages(customer_id, direction, channel, body, meta_json, created_at)
    VALUES(?1, ?2, 'telegram', ?3, ?4, ?5)
  `).bind(customerId || null, direction, clean(body), JSON.stringify(meta || {}), nowIso()).run();
}

async function createLead(env, data) {
  const ts = nowIso();
  await env.DB.prepare(`
    INSERT INTO leads(customer_id, full_name, phone, message, status, source, created_at, updated_at)
    VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
  `).bind(
    data.customer_id || null,
    clean(data.full_name),
    clean(data.phone),
    clean(data.message),
    clean(data.status) || "new",
    clean(data.source) || "telegram",
    ts,
  ).run();
}

async function searchProducts(env, query, limit = 8) {
  const q = escapeLike(query);
  if (!q) {
    const rows = await env.DB.prepare(`
      SELECT * FROM products
      WHERE is_active = 1
      ORDER BY updated_at DESC, id DESC
      LIMIT ?1
    `).bind(limit).all();
    return rows.results || [];
  }

  const like = `%${q}%`;
  const rows = await env.DB.prepare(`
    SELECT * FROM products
    WHERE is_active = 1
      AND (
        LOWER(sku) LIKE ?1 ESCAPE '\\' OR
        LOWER(name) LIKE ?1 ESCAPE '\\' OR
        LOWER(category) LIKE ?1 ESCAPE '\\' OR
        LOWER(description) LIKE ?1 ESCAPE '\\'
      )
    ORDER BY stock DESC, updated_at DESC
    LIMIT ?2
  `).bind(like, limit).all();
  return rows.results || [];
}

async function searchFaqs(env, query, limit = 5) {
  const q = escapeLike(query);
  if (!q) return [];
  const like = `%${q}%`;
  const rows = await env.DB.prepare(`
    SELECT * FROM faqs
    WHERE is_active = 1
      AND (LOWER(question) LIKE ?1 ESCAPE '\\' OR LOWER(answer) LIKE ?1 ESCAPE '\\')
    ORDER BY updated_at DESC, id DESC
    LIMIT ?2
  `).bind(like, limit).all();
  return rows.results || [];
}

function productsToPersianText(products, settings = DEFAULT_SETTINGS) {
  if (!products.length) return "";
  return products.map((p, index) => {
    const stock = Number(p.stock || 0) > 0
      ? `موجودی: ${new Intl.NumberFormat("fa-IR").format(p.stock)}`
      : "موجودی نیازمند استعلام";
    const category = p.category ? ` | ${p.category}` : "";
    const desc = p.description ? `\n${p.description}` : "";
    return `${index + 1}. ${p.name}${category}\nقیمت: ${formatMoney(p.price, settings.currency)} | ${stock}${desc}`;
  }).join("\n\n");
}

async function buildSmartAnswer(env, userText) {
  const [settings, products, faqs] = await Promise.all([
    getSettings(env),
    searchProducts(env, userText, 6),
    searchFaqs(env, userText, 4),
  ]);

  const contextParts = [
    products.length ? `محصولات مرتبط:\n${productsToPersianText(products, settings)}` : "",
    faqs.length
      ? `دانش‌نامه:\n${faqs.map((f) => `سوال: ${f.question}\nپاسخ: ${f.answer}`).join("\n---\n")}`
      : "",
  ].filter(Boolean);

  if (env.AI && contextParts.length) {
    try {
      const aiResponse = await env.AI.run(env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content:
              "تو دستیار فروش فارسی هستی. فقط با داده‌های فروشگاه پاسخ بده. پاسخ کوتاه، مودب، دقیق و مناسب کسب‌وکار باشد. اگر داده کافی نیست، بگو اپراتور بررسی می‌کند.",
          },
          {
            role: "user",
            content: `اطلاعات فروشگاه:\n${contextParts.join("\n\n")}\n\nسوال مشتری:\n${userText}`,
          },
        ],
        max_tokens: 360,
      });
      const textValue = clean(aiResponse?.response || aiResponse?.result?.response || aiResponse?.text);
      if (textValue) {
        return { answer: textValue, confidence: "ai", products, faqs };
      }
    } catch (error) {
      console.log("Workers AI error", error?.message || error);
    }
  }

  if (products.length) {
    return {
      answer:
        `این موارد را پیدا کردم:\n\n${productsToPersianText(products, settings)}\n\nبرای ثبت سفارش، نام محصول، تعداد و شماره تماس خود را ارسال کنید.`,
      confidence: "catalog",
      products,
      faqs,
    };
  }

  if (faqs.length) {
    return {
      answer: faqs.map((f) => `${f.question}\n${f.answer}`).join("\n\n"),
      confidence: "faq",
      products,
      faqs,
    };
  }

  return {
    answer: settings.operator_message || DEFAULT_SETTINGS.operator_message,
    confidence: "operator",
    products,
    faqs,
  };
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: "مشاهده محصولات" }, { text: "جستجوی محصول" }],
      [{ text: "ثبت سفارش" }, { text: "راهنمای پرداخت" }],
      [{ text: "وضعیت سفارش" }, { text: "پشتیبانی" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function sendTelegram(env, chatId, message, replyMarkup = undefined) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN is not configured");
    return;
  }

  const payload = {
    chat_id: chatId,
    text: clean(message).slice(0, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.log("Telegram send error", await response.text());
  }
}

function paymentInstructionText(settings = DEFAULT_SETTINGS, orderCode = "") {
  const lines = [];
  if (settings.payment_link) lines.push(`لینک پرداخت: ${settings.payment_link}`);
  if (settings.payment_card) lines.push(`شماره کارت: ${settings.payment_card}`);
  if (settings.payment_iban) lines.push(`شبا: ${settings.payment_iban}`);
  if (settings.payment_account_name) lines.push(`به نام: ${settings.payment_account_name}`);
  if (!lines.length) {
    lines.push("روش پرداخت هنوز در پنل تنظیم نشده است. اپراتور برای هماهنگی پرداخت با شما تماس می‌گیرد.");
  }
  lines.push(`بعد از پرداخت، عبارت «پرداخت شد ${orderCode}» یا شماره پیگیری را همینجا ارسال کنید.`);
  return lines.join("\n");
}

async function resolveProductForOrder(env, userText) {
  const normalized = normalizeFa(userText);
  const skuMatch = clean(userText).match(/[A-Za-z]{2,}[-_]?\d{1,}|[A-Za-z0-9_-]{4,}/)?.[0] || "";
  if (skuMatch) {
    const exact = await env.DB.prepare("SELECT * FROM products WHERE is_active = 1 AND LOWER(sku) = LOWER(?1) LIMIT 1")
      .bind(skuMatch)
      .first();
    if (exact) return exact;
  }

  const cleanedQuery = normalized
    .replace(/خرید|سفارش|ثبت|میخوام|می‌خوام|لطفا|عدد|تعداد/g, " ")
    .replace(/\d+/g, " ")
    .trim();
  const products = await searchProducts(env, cleanedQuery || userText, 3);
  return products.length === 1 ? products[0] : null;
}

async function createOrderFromProduct(env, customer, product, quantity, userText, origin) {
  const settings = await getSettings(env);
  const ts = nowIso();
  const qty = Math.max(1, Math.min(Number(quantity || 1), 99));
  const orderCode = generateOrderCode(settings);
  const total = Number(product.price || 0) * qty;
  const phone = detectPhone(userText);
  const invoiceUrl = `${origin}/invoice/${encodeURIComponent(orderCode)}`;

  await env.DB.prepare(`
    INSERT INTO orders(customer_id, status, total_amount, notes, created_at, updated_at, order_code, payment_status, payment_method, customer_phone)
    VALUES(?1, 'awaiting_payment', ?2, ?3, ?4, ?4, ?5, 'unpaid', 'manual', ?6)
  `).bind(
    customer?.id || null,
    total,
    clean(userText),
    ts,
    orderCode,
    phone,
  ).run();

  const order = await env.DB.prepare("SELECT * FROM orders WHERE order_code = ?1").bind(orderCode).first();
  await env.DB.prepare(`
    INSERT INTO order_items(order_id, product_id, product_name, quantity, unit_price)
    VALUES(?1, ?2, ?3, ?4, ?5)
  `).bind(order.id, product.id, product.name, qty, product.price || 0).run();

  if (phone && customer?.id) {
    await env.DB.prepare("UPDATE customers SET phone = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(phone, ts, customer.id)
      .run();
  }

  const paymentText = paymentInstructionText(settings, orderCode);
  const reply = [
    "✅ سفارش شما ثبت شد.",
    `کد سفارش: ${orderCode}`,
    `محصول: ${product.name}`,
    `تعداد: ${new Intl.NumberFormat("fa-IR").format(qty)}`,
    `مبلغ قابل پرداخت: ${formatMoney(total, settings.currency)}`,
    `فاکتور آنلاین: ${invoiceUrl}`,
    "",
    "روش پرداخت:",
    paymentText,
    "",
    settings.delivery_info || DEFAULT_SETTINGS.delivery_info,
  ].join("\n");

  return { order, reply, invoiceUrl };
}

async function getOrderByCodeOrLatest(env, customerId, userText) {
  const code = clean(userText).match(/[A-Za-z]{1,8}-[A-Z0-9]{4,}-[A-Z0-9]{2,}/i)?.[0] || "";
  if (code) {
    return await env.DB.prepare("SELECT * FROM orders WHERE UPPER(order_code) = UPPER(?1) LIMIT 1").bind(code).first();
  }
  if (!customerId) return null;
  return await env.DB.prepare("SELECT * FROM orders WHERE customer_id = ?1 ORDER BY id DESC LIMIT 1")
    .bind(customerId)
    .first();
}

async function markPaymentReported(env, customerId, userText) {
  const order = await getOrderByCodeOrLatest(env, customerId, userText);
  if (!order) return null;
  const note = clean([order.notes, `اعلام پرداخت مشتری: ${clean(userText) || "رسید/فیش ارسال شد"}`].filter(Boolean).join("\n---\n"));
  await env.DB.prepare(`
    UPDATE orders
    SET status = 'payment_reported', payment_status = 'reported', payment_reference = ?1, notes = ?2, updated_at = ?3
    WHERE id = ?4
  `).bind(clean(userText).slice(0, 200), note, nowIso(), order.id).run();
  return await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(order.id).first();
}

function orderStatusText(order, settings = DEFAULT_SETTINGS) {
  if (!order) return "سفارشی پیدا نشد. کد سفارش را دقیق‌تر ارسال کنید.";
  return [
    `کد سفارش: ${order.order_code || `#${order.id}`}`,
    `وضعیت سفارش: ${statusLabelFa(order.status)}`,
    `وضعیت پرداخت: ${statusLabelFa(order.payment_status)}`,
    `مبلغ: ${formatMoney(order.total_amount, settings.currency)}`,
    order.customer_phone ? `موبایل: ${order.customer_phone}` : "",
  ].filter(Boolean).join("\n");
}

function detectPhone(textValue) {
  return normalizeDigits(textValue).match(/(?:\+98|0098|98|0)?9\d{9}/)?.[0] || "";
}

function looksLikeOrder(textValue) {
  return /سفارش|خرید|میخوام|می‌خوام|تماس|شماره|رزرو/.test(normalizeFa(textValue));
}

function looksLikePaymentReport(textValue) {
  return /پرداخت|واریز|رسید|فیش|کارت به کارت|کارت‌به‌کارت|پیگیری|تراکنش/.test(normalizeFa(textValue));
}

function looksLikeStatusRequest(textValue) {
  return /وضعیت سفارش|پیگیری سفارش|سفارشم|کد سفارش/.test(normalizeFa(textValue));
}

function extractQuantity(textValue) {
  const normalized = normalizeDigits(textValue);
  const match = normalized.match(/(?:تعداد|عدد|x|×)\s*(\d{1,3})|(?:^|\s)(\d{1,3})\s*(?:عدد|تا)/i);
  const n = Number(match?.[1] || match?.[2] || 1);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 1;
}

function generateOrderCode(settings = DEFAULT_SETTINGS) {
  const prefix = clean(settings.order_prefix || DEFAULT_SETTINGS.order_prefix).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || "SB";
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

function statusLabelFa(value) {
  return ({
    draft: "پیش‌نویس",
    awaiting_payment: "در انتظار پرداخت",
    payment_reported: "پرداخت اعلام شده",
    paid: "پرداخت تایید شده",
    confirmed: "تایید شده",
    sent: "ارسال شده",
    cancelled: "لغو شده",
    unpaid: "پرداخت نشده",
    reported: "رسید ارسال شده",
    verified: "تایید پرداخت",
  })[value] || value || "-";
}

async function handleTelegramWebhook(request, env) {
  requireDb(env);
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return fail("TELEGRAM_WEBHOOK_SECRET تنظیم نشده و وبهوک قابل پذیرش نیست.", 500);
  }

  const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (got !== env.TELEGRAM_WEBHOOK_SECRET) {
    return fail("توکن امنیتی وبهوک تلگرام معتبر نیست.", 403);
  }

  const update = await readJson(request);
  const message = update.message || update.edited_message;
  if (!message?.chat?.id) return json({ ok: true, ignored: true });

  const chatId = message.chat.id;
  const userText = clean(message.text || message.caption || "");
  const customer = await upsertCustomer(env, message.from, chatId);
  await saveMessage(env, customer.id, "in", userText || "[پیام غیرمتنی]", update);

  let reply = "";
  const settings = await getSettings(env);
  const normalizedText = normalizeFa(userText);

  if (!userText && message.photo?.length) {
    const order = await markPaymentReported(env, customer.id, "رسید تصویری ارسال شد");
    reply = order
      ? `رسید پرداخت برای سفارش ${order.order_code || `#${order.id}`} ثبت شد. اپراتور پرداخت را بررسی و وضعیت را بروزرسانی می‌کند.`
      : "رسید دریافت شد، اما سفارش باز پیدا نشد. لطفا کد سفارش را هم ارسال کنید.";
  } else if (!userText || normalizedText === "/start" || normalizedText === "start") {
    reply = `${settings.welcome_message || DEFAULT_SETTINGS.welcome_message}

دستورهای سریع:
/products مشاهده محصولات
خرید MOB-001 ثبت سفارش با کد محصول
وضعیت سفارش + کد سفارش
پرداخت اعلام روش‌های پرداخت`;
  } else if (normalizedText === "/products" || normalizedText.includes("مشاهده محصولات") || normalizedText === "محصولات") {
    const products = await searchProducts(env, "", 10);
    reply = products.length
      ? `محصولات منتخب فروشگاه:

${productsToPersianText(products, settings)}

برای خرید بنویسید: خرید کد محصول
مثال: خرید MOB-001`
      : "هنوز محصولی ثبت نشده است. پیام شما برای اپراتور ثبت می‌شود.";
  } else if (normalizedText.includes("جستجوی محصول")) {
    reply = "نام محصول، دسته‌بندی یا بودجه مدنظر را بنویسید تا گزینه‌های مناسب را معرفی کنم.";
  } else if (normalizedText.includes("راهنمای پرداخت") || normalizedText === "پرداخت" || normalizedText.includes("روش پرداخت")) {
    reply = `روش‌های پرداخت فروشگاه:
${paymentInstructionText(settings, "کد-سفارش")}

برای ساخت فاکتور، ابتدا محصول را سفارش دهید. مثال: خرید MOB-001`;
  } else if (looksLikeStatusRequest(userText) || normalizedText.includes("وضعیت سفارش")) {
    const order = await getOrderByCodeOrLatest(env, customer.id, userText);
    reply = orderStatusText(order, settings);
  } else if (looksLikePaymentReport(userText)) {
    const order = await markPaymentReported(env, customer.id, userText);
    reply = order
      ? `اعلام پرداخت ثبت شد.
${orderStatusText(order, settings)}
اپراتور پرداخت را بررسی و سفارش را تایید می‌کند.`
      : "اعلام پرداخت دریافت شد، اما سفارش باز پیدا نشد. لطفا کد سفارش را هم همراه رسید ارسال کنید.";
  } else if (normalizedText.includes("ثبت سفارش") || looksLikeOrder(userText)) {
    const product = await resolveProductForOrder(env, userText);
    if (product) {
      const result = await createOrderFromProduct(env, customer, product, extractQuantity(userText), userText, new URL(request.url).origin);
      reply = result.reply;
    } else {
      reply = "برای ثبت سفارش، کد یا نام دقیق محصول، تعداد و شماره تماس را ارسال کنید. مثال: خرید MOB-001 تعداد ۲ 09120000000";
      await createLead(env, {
        customer_id: customer.id,
        full_name: customer.full_name,
        phone: detectPhone(userText),
        message: userText,
        status: "needs_review",
        source: "telegram",
      });
    }
  } else if (normalizedText.includes("پشتیبانی")) {
    reply = "سوال خود را همینجا بنویسید. اگر پاسخ قطعی در اطلاعات فروشگاه نباشد، برای اپراتور ثبت می‌شود.";
  } else {
    const smart = await buildSmartAnswer(env, userText);
    reply = smart.answer;

    if (smart.confidence === "operator" || detectPhone(userText) || looksLikeOrder(userText)) {
      await createLead(env, {
        customer_id: customer.id,
        full_name: customer.full_name,
        phone: detectPhone(userText),
        message: userText,
        status: smart.confidence === "operator" ? "needs_review" : "new",
        source: "telegram",
      });
    }
  }

  await sendTelegram(env, chatId, reply, mainKeyboard());
  await saveMessage(env, customer.id, "out", reply, {});
  return json({ ok: true });
}

function parseCsv(csvText) {
  const csv = clean(csvText).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value.trim());
      value = "";
    } else if (char === "\n") {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value.trim());
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => clean(item)));
}

function csvEscape(value) {
  const textValue = String(value ?? "");
  if (/[",\n\r]/.test(textValue)) return `"${textValue.replace(/"/g, '""')}"`;
  return textValue;
}

function productsToCsv(products) {
  const lines = [PRODUCT_COLUMNS.join(",")];
  for (const product of products) {
    lines.push(PRODUCT_COLUMNS.map((column) => csvEscape(product[column])).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

function validateCsvRows(rows) {
  const errors = [];
  if (!rows.length) return { headers: [], records: [], errors: ["فایل CSV خالی است."] };

  const headers = rows[0].map((header) => normalizeFa(header));
  const missing = PRODUCT_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) {
    errors.push(`ستون‌های الزامی پیدا نشد: ${missing.join(", ")}`);
  }

  const records = rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, columnIndex) => [header, clean(row[columnIndex])]));
    const rowNumber = index + 2;

    if (!record.sku) errors.push(`ردیف ${rowNumber}: ستون sku خالی است.`);
    if (!record.name) errors.push(`ردیف ${rowNumber}: نام محصول خالی است.`);

    const price = toNumber(record.price);
    const stock = toNumber(record.stock);
    if (!Number.isFinite(price) || price < 0) errors.push(`ردیف ${rowNumber}: قیمت باید عدد صفر یا بزرگ‌تر باشد.`);
    if (!Number.isFinite(stock) || stock < 0) errors.push(`ردیف ${rowNumber}: موجودی باید عدد صفر یا بزرگ‌تر باشد.`);

    return {
      sku: record.sku,
      name: record.name,
      category: record.category || "",
      price,
      stock,
      description: record.description || "",
    };
  });

  return { headers, records, errors };
}

async function importProductsCsv(env, csvText) {
  const parsed = validateCsvRows(parseCsv(csvText));
  if (parsed.errors.length) return { inserted: 0, updated: 0, total: parsed.records.length, errors: parsed.errors };

  let inserted = 0;
  let updated = 0;
  const ts = nowIso();

  for (const record of parsed.records) {
    const exists = await env.DB.prepare("SELECT id FROM products WHERE sku = ?1")
      .bind(record.sku)
      .first();

    await env.DB.prepare(`
      INSERT INTO products(sku, name, category, price, stock, description, is_active, created_at, updated_at)
      VALUES(?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
      ON CONFLICT(sku) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        price = excluded.price,
        stock = excluded.stock,
        description = excluded.description,
        is_active = 1,
        updated_at = excluded.updated_at
    `).bind(
      record.sku,
      record.name,
      record.category,
      record.price,
      record.stock,
      record.description,
      ts,
    ).run();

    if (exists) updated++;
    else inserted++;
  }

  return { inserted, updated, total: parsed.records.length, errors: [] };
}

async function listProducts(env, url) {
  const { limit, offset, q } = parseLimitOffset(url);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const rows = await env.DB.prepare(`
      SELECT * FROM products
      WHERE LOWER(sku) LIKE ?1 ESCAPE '\\'
         OR LOWER(name) LIKE ?1 ESCAPE '\\'
         OR LOWER(category) LIKE ?1 ESCAPE '\\'
         OR LOWER(description) LIKE ?1 ESCAPE '\\'
      ORDER BY is_active DESC, updated_at DESC, id DESC
      LIMIT ?2 OFFSET ?3
    `).bind(like, limit, offset).all();
    return rows.results || [];
  }

  const rows = await env.DB.prepare(`
    SELECT * FROM products
    ORDER BY is_active DESC, updated_at DESC, id DESC
    LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all();
  return rows.results || [];
}

async function listSimple(env, table, url) {
  const allowed = new Set(["customers", "faqs", "leads", "orders"]);
  if (!allowed.has(table)) throw new Error("نام جدول معتبر نیست.");
  const { limit, offset } = parseLimitOffset(url);
  const rows = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ?1 OFFSET ?2`)
    .bind(limit, offset)
    .all();
  return rows.results || [];
}

async function listMessages(env, url) {
  const { limit, offset } = parseLimitOffset(url);
  const rows = await env.DB.prepare(`
    SELECT messages.*, customers.full_name, customers.username
    FROM messages
    LEFT JOIN customers ON customers.id = messages.customer_id
    ORDER BY messages.id DESC
    LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all();
  return rows.results || [];
}

async function listOrders(env, url) {
  const { limit, offset } = parseLimitOffset(url);
  const rows = await env.DB.prepare(`
    SELECT
      orders.*,
      customers.full_name AS customer_name,
      customers.username AS customer_username,
      customers.phone AS customer_saved_phone,
      (SELECT COUNT(*) FROM order_items WHERE order_items.order_id = orders.id) AS items_count
    FROM orders
    LEFT JOIN customers ON customers.id = orders.customer_id
    ORDER BY orders.id DESC
    LIMIT ?1 OFFSET ?2
  `).bind(limit, offset).all();
  return rows.results || [];
}

async function getInvoice(env, orderCode) {
  const order = await env.DB.prepare(`
    SELECT orders.*, customers.full_name AS customer_name, customers.username AS customer_username
    FROM orders
    LEFT JOIN customers ON customers.id = orders.customer_id
    WHERE UPPER(orders.order_code) = UPPER(?1) OR CAST(orders.id AS TEXT) = ?1
    LIMIT 1
  `).bind(clean(orderCode)).first();
  if (!order) return null;
  const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?1 ORDER BY id").bind(order.id).all();
  return { order, items: items.results || [] };
}

function renderInvoiceHtml(invoice, settings = DEFAULT_SETTINGS) {
  const { order, items } = invoice;
  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtmlForHtml(item.product_name)}</td>
      <td>${new Intl.NumberFormat("fa-IR").format(item.quantity)}</td>
      <td>${formatMoney(item.unit_price, settings.currency)}</td>
      <td>${formatMoney(Number(item.unit_price || 0) * Number(item.quantity || 1), settings.currency)}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>فاکتور ${escapeHtmlForHtml(order.order_code || order.id)}</title>
<style>
body{margin:0;background:#0f172a;color:#e5e7eb;font-family:Tahoma,Arial,sans-serif;line-height:1.8}.wrap{max-width:860px;margin:32px auto;padding:24px}.card{background:linear-gradient(135deg,#111827,#172554);border:1px solid rgba(255,255,255,.12);border-radius:28px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 12px;font-size:28px}.muted{color:#a5b4fc}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}.box{background:rgba(255,255,255,.07);border-radius:18px;padding:14px}table{width:100%;border-collapse:collapse;margin-top:16px;background:rgba(255,255,255,.04);border-radius:18px;overflow:hidden}th,td{padding:12px;border-bottom:1px solid rgba(255,255,255,.08);text-align:right}th{color:#bfdbfe}.total{font-size:22px;font-weight:800;color:#86efac}.pay{white-space:pre-line;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.25);padding:16px;border-radius:18px;margin-top:20px}.footer{margin-top:20px;color:#cbd5e1;font-size:14px}@media print{body{background:#fff;color:#111}.card{box-shadow:none;border:1px solid #ddd;background:#fff}.box,table,.pay{background:#fff;border:1px solid #ddd}.muted,.footer{color:#444}}
</style>
</head>
<body><main class="wrap"><section class="card">
<h1>فاکتور سفارش</h1>
<p class="muted">${escapeHtmlForHtml(settings.shop_name || DEFAULT_SETTINGS.shop_name)}</p>
<div class="grid">
  <div class="box">کد سفارش<br><strong dir="ltr">${escapeHtmlForHtml(order.order_code || `#${order.id}`)}</strong></div>
  <div class="box">وضعیت سفارش<br><strong>${escapeHtmlForHtml(statusLabelFa(order.status))}</strong></div>
  <div class="box">وضعیت پرداخت<br><strong>${escapeHtmlForHtml(statusLabelFa(order.payment_status))}</strong></div>
  <div class="box">مشتری<br><strong>${escapeHtmlForHtml(order.customer_name || order.customer_username || "مشتری تلگرام")}</strong></div>
</div>
<table><thead><tr><th>شرح</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>${rows || `<tr><td colspan="4">آیتمی ثبت نشده است.</td></tr>`}</tbody></table>
<p class="total">مبلغ کل: ${formatMoney(order.total_amount, settings.currency)}</p>
<div class="pay">${escapeHtmlForHtml(paymentInstructionText(settings, order.order_code || `#${order.id}`))}</div>
<p class="footer">${escapeHtmlForHtml(settings.delivery_info || DEFAULT_SETTINGS.delivery_info)}</p>
</section></main></body></html>`;
}

function escapeHtmlForHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function seedDemo(env) {
  const ts = nowIso();
  const products = [
    ["MOB-001", "گوشی سامسونگ Galaxy A55", "موبایل", 18500000, 7, "حافظه ۲۵۶ گیگ، مناسب استفاده روزمره و تولید محتوا"],
    ["ACC-101", "کابل شارژ تایپ‌سی فست شارژ", "لوازم جانبی", 180000, 35, "کیفیت بالا، مناسب گوشی‌های اندرویدی و پاوربانک"],
    ["HED-220", "هندزفری بلوتوثی اقتصادی", "صدا", 690000, 14, "باتری مناسب، مکالمه شفاف و گارانتی تست سلامت"],
    ["LAP-501", "لپ‌تاپ اداری سبک", "لپ‌تاپ", 32500000, 3, "مناسب حسابداری، آفیس، آموزش آنلاین و کار روزانه"],
    ["HOM-330", "جارو شارژی خانگی", "خانه", 2450000, 9, "سبک، قابل حمل و مناسب نظافت سریع روزانه"],
  ];

  for (const product of products) {
    await env.DB.prepare(`
      INSERT INTO products(sku, name, category, price, stock, description, is_active, created_at, updated_at)
      VALUES(?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
      ON CONFLICT(sku) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        price = excluded.price,
        stock = excluded.stock,
        description = excluded.description,
        is_active = 1,
        updated_at = excluded.updated_at
    `).bind(...product, ts).run();
  }

  const faqs = [
    ["ارسال چقدر زمان می‌برد؟", "ارسال داخل شهر معمولا همان روز یا روز بعد انجام می‌شود. برای شهرهای دیگر زمان تحویل به شرکت حمل‌ونقل بستگی دارد."],
    ["امکان پرداخت در محل دارید؟", "برای بعضی شهرها پرداخت در محل فعال است. نام شهر خود را ارسال کنید تا بررسی شود."],
    ["چطور سفارش ثبت کنم؟", "نام محصول، تعداد و شماره تماس خود را ارسال کنید تا سفارش شما ثبت و پیگیری شود."],
    ["محصولات گارانتی دارند؟", "شرایط گارانتی برای هر محصول متفاوت است. نام محصول را ارسال کنید تا وضعیت دقیق اعلام شود."],
  ];

  for (const faq of faqs) {
    await env.DB.prepare(`
      INSERT INTO faqs(question, answer, is_active, created_at, updated_at)
      VALUES(?1, ?2, 1, ?3, ?3)
      ON CONFLICT(question) DO UPDATE SET
        answer = excluded.answer,
        is_active = 1,
        updated_at = excluded.updated_at
    `).bind(...faq, ts).run();
  }

  await createLead(env, {
    full_name: "مشتری نمونه",
    phone: "09120000000",
    message: "برای گوشی زیر ۲۰ میلیون مشاوره می‌خواهم.",
    status: "new",
    source: "demo",
  });

  return { products: products.length, faqs: faqs.length };
}

async function handleAdmin(request, env, url) {
  requireDb(env);
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  await ensureSettings(env);

  const path = url.pathname;
  const method = request.method;
  const productId = path.match(/^\/api\/admin\/products\/(\d+)$/)?.[1];
  const faqId = path.match(/^\/api\/admin\/faqs\/(\d+)$/)?.[1];
  const leadId = path.match(/^\/api\/admin\/leads\/(\d+)$/)?.[1];
  const orderId = path.match(/^\/api\/admin\/orders\/(\d+)$/)?.[1];

  if (method === "GET" && path === "/api/admin/stats") {
    const tables = ["customers", "products", "faqs", "messages", "leads", "orders"];
    const stats = {};
    for (const tableName of tables) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first();
      stats[tableName] = row?.count || 0;
    }
    const recentLeads = await env.DB.prepare("SELECT * FROM leads ORDER BY id DESC LIMIT 6").all();
    const revenue = await env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE status IN ('paid','confirmed','sent') OR payment_status IN ('verified')").first();
    const awaitingPayment = await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'awaiting_payment' OR payment_status = 'unpaid'").first();
    return json({
      ok: true,
      stats: { ...stats, revenue: revenue?.total || 0, awaiting_payment: awaitingPayment?.count || 0 },
      recentLeads: recentLeads.results || [],
    });
  }

  if (method === "POST" && path === "/api/admin/demo/seed") {
    return json({ ok: true, message: "داده دمو با موفقیت ساخته شد.", result: await seedDemo(env) });
  }

  if (method === "POST" && path === "/api/admin/telegram/set-webhook") {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return fail("TELEGRAM_BOT_TOKEN تنظیم نشده است. ابتدا آن را با Secretهای Cloudflare تنظیم کنید.", 500);
    }
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      return fail("TELEGRAM_WEBHOOK_SECRET تنظیم نشده است. ابتدا یک مقدار امن برای وبهوک تلگرام تنظیم کنید.", 500);
    }

    const origin = url.origin;
    const webhookUrl = `${origin}/telegram/webhook`;
    const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        drop_pending_updates: true,
      }),
    });
    const telegramResult = await telegramResponse.json().catch(() => ({}));

    if (!telegramResponse.ok || telegramResult.ok === false) {
      return fail("تنظیم وبهوک تلگرام ناموفق بود. وضعیت Worker، توکن ربات و دسترسی تلگرام را بررسی کنید.", 502, {
        telegram_ok: Boolean(telegramResult.ok),
        telegram_error: telegramResult.description || "پاسخ معتبر از تلگرام دریافت نشد.",
      });
    }

    return json({
      ok: true,
      message: "وبهوک تلگرام با موفقیت تنظیم شد.",
      webhook_url: webhookUrl,
      telegram: {
        ok: true,
        description: telegramResult.description || "Webhook was set.",
      },
    });
  }

  if (method === "GET" && path === "/api/admin/telegram/webhook-info") {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return fail("TELEGRAM_BOT_TOKEN تنظیم نشده است. ابتدا آن را با Secretهای Cloudflare تنظیم کنید.", 500);
    }

    const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    const telegramResult = await telegramResponse.json().catch(() => ({}));

    if (!telegramResponse.ok || telegramResult.ok === false) {
      return fail("دریافت اطلاعات وبهوک تلگرام ناموفق بود.", 502, {
        telegram_ok: Boolean(telegramResult.ok),
        telegram_error: telegramResult.description || "پاسخ معتبر از تلگرام دریافت نشد.",
      });
    }

    return json({
      ok: true,
      message: "اطلاعات وبهوک تلگرام دریافت شد.",
      webhook: telegramResult.result || {},
    });
  }

  if (method === "GET" && path === "/api/admin/settings") {
    return json({ ok: true, settings: await getSettings(env) });
  }

  if ((method === "POST" || method === "PATCH") && path === "/api/admin/settings") {
    const body = await readJson(request);
    const allowed = ["shop_name", "welcome_message", "operator_message", "currency", "business_hours", "support_phone", "payment_card", "payment_iban", "payment_account_name", "payment_link", "delivery_info", "order_prefix"];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        await env.DB.prepare(`
          INSERT INTO settings(key, value, updated_at) VALUES(?1, ?2, ?3)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).bind(key, clean(body[key]), nowIso()).run();
      }
    }
    return json({ ok: true, message: "تنظیمات ذخیره شد.", settings: await getSettings(env) });
  }

  if (method === "GET" && path === "/api/admin/products") {
    return json({ ok: true, products: await listProducts(env, url) });
  }

  if (method === "GET" && path === "/api/admin/products/export.csv") {
    const rows = await env.DB.prepare("SELECT sku, name, category, price, stock, description FROM products ORDER BY id DESC").all();
    return text(productsToCsv(rows.results || []), 200, "text/csv; charset=utf-8", {
      "content-disposition": 'attachment; filename="products-export.csv"',
    });
  }

  if (method === "GET" && path === "/api/admin/template/products.csv") {
    return text(
      "\uFEFFsku,name,category,price,stock,description\nMOB-001,گوشی نمونه,موبایل,12000000,5,توضیح کوتاه محصول\n",
      200,
      "text/csv; charset=utf-8",
      { "content-disposition": 'attachment; filename="products-template.csv"' },
    );
  }

  if (method === "POST" && path === "/api/admin/products") {
    const body = await readJson(request);
    const sku = clean(body.sku) || `SKU-${Date.now()}`;
    const name = clean(body.name);
    const price = toNumber(body.price);
    const stock = toNumber(body.stock);
    if (!name) return fail("نام محصول الزامی است.", 422);
    if (!Number.isFinite(price) || price < 0) return fail("قیمت باید عدد صفر یا بزرگ‌تر باشد.", 422);
    if (!Number.isFinite(stock) || stock < 0) return fail("موجودی باید عدد صفر یا بزرگ‌تر باشد.", 422);

    await env.DB.prepare(`
      INSERT INTO products(sku, name, category, price, stock, description, is_active, created_at, updated_at)
      VALUES(?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
    `).bind(sku, name, clean(body.category), price, stock, clean(body.description), nowIso()).run();
    return json({ ok: true, message: "محصول ثبت شد." }, 201);
  }

  if (method === "PATCH" && productId) {
    const body = await readJson(request);
    const current = await env.DB.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first();
    if (!current) return fail("محصول پیدا نشد.", 404);
    const next = {
      sku: clean(body.sku ?? current.sku),
      name: clean(body.name ?? current.name),
      category: clean(body.category ?? current.category),
      price: body.price === undefined ? current.price : toNumber(body.price),
      stock: body.stock === undefined ? current.stock : toNumber(body.stock),
      description: clean(body.description ?? current.description),
      is_active: body.is_active === undefined ? current.is_active : Number(Boolean(body.is_active)),
    };
    if (!next.name) return fail("نام محصول الزامی است.", 422);
    await env.DB.prepare(`
      UPDATE products
      SET sku=?1, name=?2, category=?3, price=?4, stock=?5, description=?6, is_active=?7, updated_at=?8
      WHERE id=?9
    `).bind(next.sku, next.name, next.category, next.price, next.stock, next.description, next.is_active, nowIso(), productId).run();
    return json({ ok: true, message: "محصول بروزرسانی شد." });
  }

  if (method === "DELETE" && productId) {
    await env.DB.prepare("UPDATE products SET is_active = 0, updated_at = ?1 WHERE id = ?2")
      .bind(nowIso(), productId)
      .run();
    return json({ ok: true, message: "محصول غیرفعال شد." });
  }

  if (method === "POST" && path === "/api/admin/products/import-csv") {
    const result = await importProductsCsv(env, await request.text());
    const status = result.errors.length ? 422 : 200;
    return json({ ok: !result.errors.length, message: result.errors.length ? "فایل CSV خطا دارد." : "ورود محصولات انجام شد.", result }, status);
  }

  if (method === "GET" && path === "/api/admin/faqs") {
    return json({ ok: true, faqs: await listSimple(env, "faqs", url) });
  }

  if (method === "POST" && path === "/api/admin/faqs") {
    const body = await readJson(request);
    if (!clean(body.question) || !clean(body.answer)) return fail("سوال و پاسخ الزامی است.", 422);
    await env.DB.prepare(`
      INSERT INTO faqs(question, answer, is_active, created_at, updated_at)
      VALUES(?1, ?2, 1, ?3, ?3)
      ON CONFLICT(question) DO UPDATE SET answer=excluded.answer, is_active=1, updated_at=excluded.updated_at
    `).bind(clean(body.question), clean(body.answer), nowIso()).run();
    return json({ ok: true, message: "سوال متداول ثبت شد." }, 201);
  }

  if (method === "PATCH" && faqId) {
    const body = await readJson(request);
    const current = await env.DB.prepare("SELECT * FROM faqs WHERE id = ?1").bind(faqId).first();
    if (!current) return fail("FAQ پیدا نشد.", 404);
    await env.DB.prepare(`
      UPDATE faqs SET question=?1, answer=?2, is_active=?3, updated_at=?4 WHERE id=?5
    `).bind(
      clean(body.question ?? current.question),
      clean(body.answer ?? current.answer),
      body.is_active === undefined ? current.is_active : Number(Boolean(body.is_active)),
      nowIso(),
      faqId,
    ).run();
    return json({ ok: true, message: "FAQ بروزرسانی شد." });
  }

  if (method === "DELETE" && faqId) {
    await env.DB.prepare("UPDATE faqs SET is_active = 0, updated_at = ?1 WHERE id = ?2").bind(nowIso(), faqId).run();
    return json({ ok: true, message: "FAQ غیرفعال شد." });
  }

  if (method === "GET" && path === "/api/admin/customers") {
    return json({ ok: true, customers: await listSimple(env, "customers", url) });
  }

  if (method === "GET" && path === "/api/admin/messages") {
    return json({ ok: true, messages: await listMessages(env, url) });
  }

  if (method === "GET" && path === "/api/admin/leads") {
    return json({ ok: true, leads: await listSimple(env, "leads", url) });
  }

  if (method === "PATCH" && leadId) {
    const body = await readJson(request);
    await env.DB.prepare("UPDATE leads SET status = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(clean(body.status) || "new", nowIso(), leadId)
      .run();
    return json({ ok: true, message: "وضعیت درخواست بروزرسانی شد." });
  }

  if (method === "GET" && path === "/api/admin/orders") {
    return json({ ok: true, orders: await listOrders(env, url) });
  }

  if (method === "GET" && path === "/api/admin/orders/export.csv") {
    const rows = await listOrders(env, new URL(`${url.origin}${url.pathname}?limit=200`));
    const columns = ["order_code", "status", "payment_status", "total_amount", "customer_name", "customer_phone", "created_at", "notes"];
    const csv = `\uFEFF${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvEscape(row[column] ?? "")).join(",")).join("\n")}\n`;
    return text(csv, 200, "text/csv; charset=utf-8", {
      "content-disposition": 'attachment; filename="orders-export.csv"',
    });
  }

  if (method === "POST" && path === "/api/admin/orders") {
    const body = await readJson(request);
    const settings = await getSettings(env);
    const total = toNumber(body.total_amount);
    const orderCode = clean(body.order_code) || generateOrderCode(settings);
    await env.DB.prepare(`
      INSERT INTO orders(customer_id, status, total_amount, notes, created_at, updated_at, order_code, payment_status, payment_method, customer_phone, payment_reference)
      VALUES(?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(
      body.customer_id || null,
      clean(body.status) || "draft",
      Number.isFinite(total) ? total : 0,
      clean(body.notes),
      nowIso(),
      orderCode,
      clean(body.payment_status) || "unpaid",
      clean(body.payment_method) || "manual",
      clean(body.customer_phone),
      clean(body.payment_reference),
    ).run();
    return json({ ok: true, message: "سفارش ثبت شد.", order_code: orderCode }, 201);
  }

  if (method === "PATCH" && orderId) {
    const body = await readJson(request);
    const current = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(orderId).first();
    if (!current) return fail("سفارش پیدا نشد.", 404);
    await env.DB.prepare(`
      UPDATE orders
      SET status = ?1, payment_status = ?2, payment_reference = ?3, customer_phone = ?4, notes = ?5, updated_at = ?6
      WHERE id = ?7
    `).bind(
      clean(body.status ?? current.status) || "draft",
      clean(body.payment_status ?? current.payment_status) || "unpaid",
      clean(body.payment_reference ?? current.payment_reference),
      clean(body.customer_phone ?? current.customer_phone),
      clean(body.notes ?? current.notes),
      nowIso(),
      orderId,
    ).run();
    return json({ ok: true, message: "سفارش بروزرسانی شد." });
  }

  if (method === "POST" && path === "/api/admin/ai/test") {
    const body = await readJson(request);
    const question = clean(body.question);
    if (!question) return fail("متن سوال را وارد کنید.", 422);
    const result = await buildSmartAnswer(env, question);
    return json({
      ok: true,
      answer: result.answer,
      confidence: result.confidence,
      sources: { products: result.products.length, faqs: result.faqs.length, workers_ai: Boolean(env.AI) },
    });
  }

  return fail("مسیر مدیریت پیدا نشد.", 404);
}

async function handlePublic(request, env, url) {
  requireDb(env);
  const invoiceMatch = url.pathname.match(/^\/invoice\/([^/]+)$/);
  if (request.method === "GET" && invoiceMatch) {
    const invoice = await getInvoice(env, decodeURIComponent(invoiceMatch[1]));
    if (!invoice) return text("فاکتور پیدا نشد.", 404, "text/plain; charset=utf-8");
    return text(renderInvoiceHtml(invoice, await getSettings(env)), 200, "text/html; charset=utf-8", {
      "cache-control": "no-store",
    });
  }

  if (request.method === "GET" && url.pathname === "/api/public/catalog") {
    return json({ ok: true, products: await searchProducts(env, url.searchParams.get("q") || "", 30) });
  }

  if (request.method === "POST" && url.pathname === "/api/public/lead") {
    const body = await readJson(request);
    if (!clean(body.phone) && !clean(body.message)) {
      return fail("شماره تماس یا پیام الزامی است.", 422);
    }
    await createLead(env, {
      full_name: clean(body.full_name || body.name),
      phone: clean(body.phone),
      message: clean(body.message),
      source: "public-api",
      status: "new",
    });
    return json({ ok: true, message: "درخواست شما ثبت شد." }, 201);
  }

  return null;
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
      const url = new URL(request.url);

      if (request.method === "GET") {
        const panelResponse = serveAdminPanel(url.pathname);
        if (panelResponse) return panelResponse;
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          ok: true,
          name: env.BOT_NAME || "AI Sales Assistant",
          serverless: true,
          d1: Boolean(env.DB),
          workers_ai: Boolean(env.AI),
          time: nowIso(),
        });
      }

      if (url.pathname === "/telegram/webhook" && request.method === "POST") {
        return await handleTelegramWebhook(request, env);
      }

      if (url.pathname.startsWith("/api/admin/")) {
        return await handleAdmin(request, env, url);
      }

      const publicResponse = await handlePublic(request, env, url);
      if (publicResponse) return publicResponse;

      return fail("مسیر درخواست پیدا نشد.", 404);
    } catch (error) {
      console.log("Worker error", error?.stack || error?.message || error);
      return fail("خطای داخلی رخ داد. تنظیمات Worker، D1 و migrationها را بررسی کنید.", 500);
    }
  },
};
