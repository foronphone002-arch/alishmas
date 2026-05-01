export const config = {
  runtime: "edge",
};

// دریافت متغیرها از تنظیمات ورسل
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const RELAY_KEY = (process.env.RELAY_KEY || "").trim();

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", 
  "proxy-authorization", "te", "trailer", "transfer-encoding", 
  "upgrade", "forwarded", "x-forwarded-host", "x-forwarded-proto", 
  "x-forwarded-port", "x-real-ip"
]);

export default async function handler(req) {
  if (!TARGET_BASE) {
    return new Response("Gateway Misconfigured: TARGET_DOMAIN missing", { status: 500 });
  }

  const url = new URL(req.url);

  // ۱. لایه استتار: اگر کسی یا رباتی مستقیم آدرس ورسل را باز کرد
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
    return new Response(JSON.stringify({
      service: "EduContent Edge Network",
      node: "fra1-gateway-7",
      status: "active",
      license_verification: "verified",
      active_sessions: Math.floor(Math.random() * 100) + 50,
      message: "Secure gateway active. Authorized requests only."
    }), { 
      status: 200, 
      headers: { "Content-Type": "application/json", "X-Cache-Status": "HIT" } 
    });
  }

  // ۲. لایه امنیتی (الهام گرفته از نسخه ECO): تایید پسورد
  if (RELAY_KEY) {
    const clientToken = req.headers.get("x-relay-key");
    if (clientToken !== RELAY_KEY) {
      return new Response("Forbidden: Invalid Authorization", { status: 403 });
    }
  }

  // ۳. لایه رفتار انسانی: کنترلر قطع رندوم (۲۰ تا ۳۵ ثانیه)
  const controller = new AbortController();
  const randomTimeout = Math.floor(Math.random() * (35000 - 20000 + 1)) + 20000;
  const timeoutId = setTimeout(() => controller.abort(), randomTimeout);

  try {
    const targetUrl = TARGET_BASE + url.pathname + url.search;
    const headers = new Headers();
    
    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      // حذف هدرهای ردگیری ورسل و هدر پسورد (تا به سرور اصلی نرود)
      if (STRIP_HEADERS.has(k) || k.startsWith("x-vercel-") || k === "x-relay-key") continue;
      headers.set(k, value);
    }

    // هدرهای سرعت و استتار
    headers.set("X-Accel-Buffering", "no"); 
    headers.set("X-Content-Origin", "Edu-Vault-Main");

    const fetchOpts = {
      method: req.method,
      headers,
      redirect: "manual",
      signal: controller.signal,
      keepalive: true
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOpts.body = req.body;
      fetchOpts.duplex = "half";
    }

    const upstream = await fetch(targetUrl, fetchOpts);
    const respHeaders = new Headers();
    
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() !== "transfer-encoding" && k.toLowerCase() !== "connection") {
        respHeaders.set(k, v);
      }
    }
    
    // تزریق هدر نهایی برای تضمین سرعت بالا (بدون بافر) در دیسکورد و ساندکلود
    respHeaders.set("X-Accel-Buffering", "no");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });

  } catch (err) {
    // قطع بی‌سروصدا در صورت رسیدن به تایمر رندوم (جلوگیری از ثبت ارور در داشبورد ورسل)
    if (err.name === 'AbortError') {
      return new Response(null, { status: 204 }); 
    }
    return new Response("Gateway Sync Error", { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
