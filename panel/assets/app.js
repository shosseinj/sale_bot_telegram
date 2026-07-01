const $ = (id) => document.getElementById(id);
const fmt = (value) => new Intl.NumberFormat("fa-IR").format(Number(value || 0));
const DEFAULT_WORKER_API = window.location.origin || "https://ai-sales-assistant-worker.hossein97jafari.workers.dev";

const state = {
  apiBase: localStorage.getItem("aiSalesApiBase") || DEFAULT_WORKER_API,
  token: localStorage.getItem("aiSalesAdminToken") || "",
  busy: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toLocalDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("fa-IR");
  } catch {
    return value;
  }
}

function statusLabel(value) {
  const labels = {
    new: "جدید",
    needs_review: "نیازمند بررسی",
    contacted: "تماس گرفته شد",
    won: "موفق",
    lost: "ناموفق",
    draft: "پیش‌نویس",
    confirmed: "تایید شده",
    sent: "ارسال شده",
    awaiting_payment: "در انتظار پرداخت",
    payment_reported: "پرداخت اعلام شده",
    paid: "پرداخت تایید شده",
    cancelled: "لغو شده",
    unpaid: "پرداخت نشده",
    reported: "رسید ارسال شده",
    verified: "تایید پرداخت",
  };
  return labels[value] || value || "-";
}

function toast(message, type = "ok") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show ${type}`;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    el.className = "toast";
  }, 3800);
}

function setConnectionStatus(text, ok = false) {
  $("connectionStatus").textContent = text;
  $("connectionStatus").style.color = ok ? "var(--green)" : "var(--danger)";
}

function setBusy(isBusy) {
  state.busy = isBusy;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

async function api(path, options = {}) {
  if (!state.apiBase || !state.token) {
    throw new Error("ابتدا آدرس Worker و توکن مدیریت را وارد کنید.");
  }

  const response = await fetch(`${state.apiBase.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${state.token}`,
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || data.message || "درخواست ناموفق بود.");
    error.data = data;
    error.status = response.status;
    throw error;
  }

  return data;
}

function renderTable(table, columns, rows) {
  if (!rows || !rows.length) {
    table.innerHTML = `<tbody><tr class="empty-row"><td>داده‌ای برای نمایش وجود ندارد.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${rows.map((row) => `
        <tr>
          ${columns.map((column) => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key] ?? "-")}</td>`).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;
}

async function downloadAdminFile(path, filename) {
  const response = await fetch(`${state.apiBase.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!response.ok) throw new Error("دانلود فایل ناموفق بود.");
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function loadStats() {
  const data = await api("/api/admin/stats");
  $("statCustomers").textContent = fmt(data.stats.customers);
  $("statProducts").textContent = fmt(data.stats.products);
  $("statLeads").textContent = fmt(data.stats.leads);
  $("statMessages").textContent = fmt(data.stats.messages);
  $("statFaqs").textContent = fmt(data.stats.faqs);
  $("statOrders").textContent = fmt(data.stats.orders);
  if ($("statRevenue")) $("statRevenue").textContent = `${fmt(data.stats.revenue)} تومان`;
  if ($("statAwaitingPayment")) $("statAwaitingPayment").textContent = fmt(data.stats.awaiting_payment);
}

async function loadProducts() {
  const q = encodeURIComponent($("productSearch").value.trim());
  const data = await api(`/api/admin/products?limit=100${q ? `&q=${q}` : ""}`);
  renderTable($("productsTable"), [
    { label: "کد", render: (row) => `<span dir="ltr">${escapeHtml(row.sku)}</span>` },
    { label: "نام محصول", key: "name" },
    { label: "دسته", key: "category" },
    { label: "قیمت", render: (row) => `${fmt(row.price)} تومان` },
    { label: "موجودی", render: (row) => `<span class="badge">${fmt(row.stock)}</span>` },
    { label: "وضعیت", render: (row) => row.is_active ? '<span class="badge">فعال</span>' : '<span class="badge danger">غیرفعال</span>' },
    {
      label: "عملیات",
      render: (row) => `<div class="row-actions"><button class="btn danger" data-action="deactivate-product" data-id="${row.id}" type="button">غیرفعال</button></div>`,
    },
  ], data.products);
}

async function loadFaqs() {
  const data = await api("/api/admin/faqs?limit=100");
  renderTable($("faqTable"), [
    { label: "سوال", key: "question" },
    { label: "پاسخ", key: "answer" },
    { label: "وضعیت", render: (row) => row.is_active ? '<span class="badge">فعال</span>' : '<span class="badge danger">غیرفعال</span>' },
    {
      label: "عملیات",
      render: (row) => `<button class="btn danger" data-action="deactivate-faq" data-id="${row.id}" type="button">غیرفعال</button>`,
    },
  ], data.faqs);
}

async function loadCustomers() {
  const data = await api("/api/admin/customers?limit=100");
  renderTable($("customersTable"), [
    { label: "نام", key: "full_name" },
    { label: "نام کاربری", render: (row) => row.username ? `<span dir="ltr">@${escapeHtml(row.username)}</span>` : "-" },
    { label: "شناسه تلگرام", render: (row) => `<span dir="ltr">${escapeHtml(row.telegram_id || "-")}</span>` },
    { label: "شماره", key: "phone" },
    { label: "آخرین بروزرسانی", render: (row) => toLocalDate(row.updated_at) },
  ], data.customers);
}

async function loadMessages() {
  const data = await api("/api/admin/messages?limit=100");
  renderTable($("messagesTable"), [
    { label: "مشتری", render: (row) => escapeHtml(row.full_name || row.username || "-") },
    { label: "جهت", render: (row) => row.direction === "in" ? '<span class="badge warn">ورودی</span>' : '<span class="badge">خروجی</span>' },
    { label: "کانال", key: "channel" },
    { label: "متن", render: (row) => escapeHtml(row.body).slice(0, 220) },
    { label: "زمان", render: (row) => toLocalDate(row.created_at) },
  ], data.messages);
}

async function loadOrders() {
  const data = await api("/api/admin/orders?limit=100");
  renderTable($("ordersTable"), [
    { label: "کد سفارش", render: (row) => row.order_code ? `<span dir="ltr">${escapeHtml(row.order_code)}</span>` : `#${fmt(row.id)}` },
    { label: "مشتری", render: (row) => escapeHtml(row.customer_name || row.customer_username || "-") },
    { label: "موبایل", render: (row) => `<span dir="ltr">${escapeHtml(row.customer_phone || row.customer_saved_phone || "-")}</span>` },
    { label: "وضعیت", render: (row) => `<span class="badge">${escapeHtml(statusLabel(row.status))}</span>` },
    { label: "پرداخت", render: (row) => `<span class="badge ${row.payment_status === "verified" ? "" : "warn"}">${escapeHtml(statusLabel(row.payment_status))}</span>` },
    { label: "مبلغ", render: (row) => `${fmt(row.total_amount)} تومان` },
    { label: "آیتم", render: (row) => fmt(row.items_count) },
    { label: "تاریخ", render: (row) => toLocalDate(row.created_at) },
    {
      label: "عملیات",
      render: (row) => `
        <div class="row-actions stacked">
          <button class="btn secondary" data-action="copy-invoice" data-code="${escapeHtml(row.order_code || row.id)}" type="button">کپی فاکتور</button>
          <select data-action="order-payment" data-id="${row.id}" aria-label="تغییر پرداخت">
            ${["unpaid", "reported", "verified"].map((status) => `<option value="${status}" ${row.payment_status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
          </select>
          <select data-action="order-status" data-id="${row.id}" aria-label="تغییر وضعیت">
            ${["awaiting_payment", "payment_reported", "paid", "confirmed", "sent", "cancelled"].map((status) => `<option value="${status}" ${row.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
          </select>
        </div>
      `,
    },
  ], data.orders);
}

async function loadLeads() {
  const data = await api("/api/admin/leads?limit=100");
  renderTable($("leadsTable"), [
    { label: "نام", key: "full_name" },
    { label: "موبایل", render: (row) => `<span dir="ltr">${escapeHtml(row.phone || "-")}</span>` },
    { label: "پیام", render: (row) => escapeHtml(row.message).slice(0, 240) },
    { label: "منبع", key: "source" },
    { label: "وضعیت", render: (row) => `<span class="badge">${escapeHtml(statusLabel(row.status))}</span>` },
    { label: "تاریخ", render: (row) => toLocalDate(row.created_at) },
    {
      label: "پیگیری",
      render: (row) => `
        <select data-action="lead-status" data-id="${row.id}" aria-label="تغییر وضعیت درخواست">
          ${["new", "needs_review", "contacted", "won", "lost"].map((status) => `
            <option value="${status}" ${row.status === status ? "selected" : ""}>${statusLabel(status)}</option>
          `).join("")}
        </select>
      `,
    },
  ], data.leads);
}

async function loadSettings() {
  const data = await api("/api/admin/settings");
  const form = $("settingsForm");
  Object.entries(data.settings || {}).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

async function refreshAll(showToast = false) {
  try {
    setBusy(true);
    await loadStats();
    await Promise.all([
      loadProducts(),
      loadFaqs(),
      loadCustomers(),
      loadMessages(),
      loadOrders(),
      loadLeads(),
      loadSettings(),
    ]);
    setConnectionStatus("متصل", true);
    if (showToast) toast("اطلاعات بروزرسانی شد.");
  } catch (error) {
    setConnectionStatus("قطع یا تنظیم نشده", false);
    toast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForms() {
  $("apiBase").value = state.apiBase;
  $("adminToken").value = state.token;

  $("saveConnectionBtn").addEventListener("click", async () => {
    state.apiBase = $("apiBase").value.trim();
    state.token = $("adminToken").value.trim();
    localStorage.setItem("aiSalesApiBase", state.apiBase);
    localStorage.setItem("aiSalesAdminToken", state.token);
    await refreshAll(true);
  });

  if ($("setWebhookBtn")) {
    $("setWebhookBtn").addEventListener("click", async () => {
      try {
        const data = await api("/api/admin/telegram/set-webhook", { method: "POST" });
        $("webhookResult").textContent = JSON.stringify(data, null, 2);
        toast("وبهوک تلگرام تنظیم شد.");
      } catch (error) {
        $("webhookResult").textContent = error.message;
        toast(error.message, "error");
      }
    });
  }

  if ($("webhookInfoBtn")) {
    $("webhookInfoBtn").addEventListener("click", async () => {
      try {
        const data = await api("/api/admin/telegram/webhook-info");
        $("webhookResult").textContent = JSON.stringify(data, null, 2);
        toast("وضعیت وبهوک دریافت شد.");
      } catch (error) {
        $("webhookResult").textContent = error.message;
        toast(error.message, "error");
      }
    });
  }

  $("refreshBtn").addEventListener("click", () => refreshAll(true));
  $("searchProductsBtn").addEventListener("click", loadProducts);
  $("productSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadProducts();
  });

  $("seedDemoBtn").addEventListener("click", async () => {
    try {
      setBusy(true);
      await api("/api/admin/demo/seed", { method: "POST" });
      toast("داده دمو ساخته شد.");
      await refreshAll();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  });

  $("productForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToObject(event.currentTarget)),
      });
      event.currentTarget.reset();
      toast("محصول ثبت شد.");
      await refreshAll();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  $("faqForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/faqs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToObject(event.currentTarget)),
      });
      event.currentTarget.reset();
      toast("FAQ ثبت شد.");
      await refreshAll();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  $("orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToObject(event.currentTarget)),
      });
      event.currentTarget.reset();
      toast("سفارش ثبت شد.");
      await refreshAll();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  $("settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToObject(event.currentTarget)),
      });
      toast("تنظیمات ذخیره شد.");
      await loadSettings();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  $("csvFile").addEventListener("change", () => {
    const file = $("csvFile").files[0];
    $("csvFileName").textContent = file ? file.name : "انتخاب فایل CSV";
  });

  $("importCsvBtn").addEventListener("click", async () => {
    const file = $("csvFile").files[0];
    if (!file) return toast("فایل CSV را انتخاب کنید.", "error");
    try {
      const data = await api("/api/admin/products/import-csv", {
        method: "POST",
        headers: { "content-type": "text/csv; charset=utf-8" },
        body: await file.text(),
      });
      $("importResult").textContent = [
        `کل ردیف‌ها: ${fmt(data.result.total)}`,
        `ثبت جدید: ${fmt(data.result.inserted)}`,
        `بروزرسانی: ${fmt(data.result.updated)}`,
      ].join("\n");
      toast("ورود محصولات انجام شد.");
      await refreshAll();
    } catch (error) {
      const result = error.data?.result;
      $("importResult").textContent = result?.errors?.length
        ? result.errors.join("\n")
        : error.message;
      toast(error.message, "error");
    }
  });

  $("downloadTemplateBtn").addEventListener("click", async () => {
    try {
      await downloadAdminFile("/api/admin/template/products.csv", "products-template.csv");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  $("exportProductsBtn").addEventListener("click", async () => {
    try {
      await downloadAdminFile("/api/admin/products/export.csv", "products-export.csv");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  if ($("exportOrdersBtn")) {
    $("exportOrdersBtn").addEventListener("click", async () => {
      try {
        await downloadAdminFile("/api/admin/orders/export.csv", "orders-export.csv");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  $("testAiBtn").addEventListener("click", async () => {
    const question = $("aiQuestion").value.trim();
    if (!question) return toast("یک سوال وارد کنید.", "error");
    $("aiAnswer").textContent = "در حال آماده‌سازی پاسخ...";
    try {
      const data = await api("/api/admin/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      $("aiAnswer").textContent = `${data.answer}\n\nمنبع پاسخ: ${data.confidence} | محصول: ${fmt(data.sources.products)} | FAQ: ${fmt(data.sources.faqs)}`;
    } catch (error) {
      $("aiAnswer").textContent = error.message;
      toast(error.message, "error");
    }
  });
}

function bindDelegatedActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    try {
      if (button.dataset.action === "deactivate-product") {
        await api(`/api/admin/products/${button.dataset.id}`, { method: "DELETE" });
        toast("محصول غیرفعال شد.");
        await refreshAll();
      }
      if (button.dataset.action === "deactivate-faq") {
        await api(`/api/admin/faqs/${button.dataset.id}`, { method: "DELETE" });
        toast("FAQ غیرفعال شد.");
        await refreshAll();
      }
      if (button.dataset.action === "copy-invoice") {
        const url = `${state.apiBase.replace(/\/$/, "")}/invoice/${encodeURIComponent(button.dataset.code)}`;
        await navigator.clipboard.writeText(url);
        toast("لینک فاکتور کپی شد.");
      }
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.addEventListener("change", async (event) => {
    const select = event.target.closest("select[data-action]");
    if (!select) return;

    try {
      if (select.dataset.action === "lead-status") {
        await api(`/api/admin/leads/${select.dataset.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: select.value }),
        });
        toast("وضعیت درخواست بروزرسانی شد.");
        await loadLeads();
      }

      if (select.dataset.action === "order-status") {
        await api(`/api/admin/orders/${select.dataset.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: select.value }),
        });
        toast("وضعیت سفارش بروزرسانی شد.");
        await loadOrders();
      }

      if (select.dataset.action === "order-payment") {
        await api(`/api/admin/orders/${select.dataset.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payment_status: select.value, status: select.value === "verified" ? "paid" : undefined }),
        });
        toast("وضعیت پرداخت بروزرسانی شد.");
        await loadOrders();
      }
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function bindNavigation() {
  const links = Array.from(document.querySelectorAll(".nav a"));
  const activate = () => {
    const hash = window.location.hash || "#dashboard";
    links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === hash));
  };
  links.forEach((link) => link.addEventListener("click", activate));
  window.addEventListener("hashchange", activate);
  activate();
}

bindForms();
bindDelegatedActions();
bindNavigation();
refreshAll();
