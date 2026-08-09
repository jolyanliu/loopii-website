// Server-rendered metadata and download fallback for public Wave shares.
// Route: loopii.io/w/:id (via netlify.toml)
// Env vars: SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const APP_STORE = "https://apps.apple.com/app/id6760251930";
const PLAY_STORE =
  "https://play.google.com/store/apps/details?id=com.huazhou.loopiiapp";
const OG_FALLBACK = "https://loopii.io/colorlogo.png";
const WAVE_BUCKET = "wave-media";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  const id = extractId(event);
  if (!UUID_RE.test(id)) return response(notFoundPage(), 404, 60);
  if (!SUPABASE_URL || !ANON_KEY) {
    return response(unavailablePage(), 503, 0);
  }

  let wave;
  try {
    const result = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_public_wave_share_preview`,
      {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_wave_id: id }),
      },
    );
    if (!result.ok) throw new Error(`preview lookup failed: ${result.status}`);
    const payload = await result.json();
    wave = Array.isArray(payload) ? payload[0] : payload;
  } catch (_) {
    return response(unavailablePage(), 503, 0);
  }

  if (!wave || wave.wave_id !== id) {
    return response(notFoundPage(), 404, 60);
  }

  const lang = preferredLanguage(event.headers || {});
  const title = cleanText(wave.title, 80) || "Check-in Wave";
  const description = cleanText(wave.description, 180);
  const checkins = nonNegativeInteger(wave.checkin_count);
  const likes = nonNegativeInteger(wave.like_count);
  const ogDescription = description || statsDescription(lang, checkins, likes);
  const pageUrl = `https://loopii.io/w/${id}`;
  const ogImage = coverUrl(wave) || OG_FALLBACK;

  return response(
    renderPage({
      id,
      lang,
      title,
      description,
      checkins,
      likes,
      ogDescription,
      ogImage,
      pageUrl,
    }),
    200,
    300,
  );
};

function extractId(event) {
  const queryId = event.queryStringParameters?.id || "";
  const parts = String(event.path || "")
    .split("/")
    .filter(Boolean);
  const last = parts.at(-1) || "";
  return queryId || (last === "wave-preview" ? "" : last);
}

function preferredLanguage(headers) {
  const accept = String(headers["accept-language"] || headers["Accept-Language"] || "")
    .toLowerCase();
  return accept.includes("zh") ? "zh" : "en";
}

function cleanText(value, maxLength) {
  const valueText = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return valueText.length > maxLength
    ? `${valueText.slice(0, maxLength - 1)}…`
    : valueText;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function statsDescription(lang, checkins, likes) {
  if (lang === "zh") {
    return `${checkins} 次现场打卡 · ${likes} 个赞 · 在 Loopii 查看这个 Wave`;
  }
  return `${checkins} on-site check-ins · ${likes} likes · View this Wave on Loopii`;
}

function coverUrl(wave) {
  const thumbnail = cleanText(wave.cover_thumbnail_path, 500);
  const cover = cleanText(wave.cover_storage_path, 500);
  const path = thumbnail || (wave.cover_media_type === "image" ? cover : "");
  if (!path) return null;
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${WAVE_BUCKET}/${encodedPath}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
  );
}

function escapeAttribute(value) {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[
        character
      ],
  );
}

function response(body, statusCode, maxAge) {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control":
        maxAge > 0
          ? `public, max-age=${maxAge}, stale-while-revalidate=600`
          : "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
    body,
  };
}

function notFoundPage() {
  return basicPage(
    "Wave not found",
    "This Wave may still be under review or may no longer be public.",
  );
}

function unavailablePage() {
  return basicPage(
    "Wave temporarily unavailable",
    "Please try again shortly or continue in Loopii.",
  );
}

function basicPage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Loopii Wave</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f3fb;color:#17131f;font-family:system-ui,sans-serif}main{max-width:420px;text-align:center;background:#fff;padding:36px 28px;border-radius:24px;box-shadow:0 18px 50px rgba(72,31,102,.14)}a{display:inline-block;margin-top:16px;color:#7b2ff2;font-weight:700}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${APP_STORE}">Get Loopii</a></main></body></html>`;
}

function renderPage(data) {
  const isZh = data.lang === "zh";
  const displayDescription = data.description || data.ogDescription;
  const checkinLabel = isZh ? "现场打卡" : "on-site check-ins";
  const likeLabel = isZh ? "赞" : "likes";
  const openLabel = isZh ? "打开 / 下载 Loopii" : "Open / Get Loopii";
  const eyebrow = isZh ? "现场 WAVE" : "CHECK-IN WAVE";
  const helper = isZh
    ? "已安装将打开对应 Wave，未安装将进入下载页面。"
    : "Opens this Wave when installed, or the download page when it is not.";
  const wechat = isZh
    ? "请点击右上角菜单，选择“在浏览器中打开”。"
    : "Use the top-right menu and choose Open in Browser.";

  return `<!doctype html>
<html lang="${data.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light only">
<meta name="robots" content="noindex,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Loopii">
<meta property="og:title" content="${escapeAttribute(data.title)}">
<meta property="og:description" content="${escapeAttribute(data.ogDescription)}">
<meta property="og:image" content="${escapeAttribute(data.ogImage)}">
<meta property="og:image:alt" content="${escapeAttribute(data.title)}">
<meta property="og:url" content="${escapeAttribute(data.pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttribute(data.title)}">
<meta name="twitter:description" content="${escapeAttribute(data.ogDescription)}">
<meta name="twitter:image" content="${escapeAttribute(data.ogImage)}">
<meta name="apple-itunes-app" content="app-id=6760251930, app-argument=${escapeAttribute(data.pageUrl)}">
<link rel="canonical" href="${escapeAttribute(data.pageUrl)}">
<title>${escapeHtml(data.title)} — Loopii Wave</title>
<style>
:root{--ink:#17131f;--muted:#6f6878;--purple:#7b2ff2;--pink:#ee2f91;--line:rgba(23,19,31,.09);--grad:linear-gradient(135deg,#ff853d,#ee2f91 58%,#8f35d2)}
*{box-sizing:border-box}html{color-scheme:light only}body{margin:0;min-height:100vh;padding:24px 18px calc(28px + env(safe-area-inset-bottom));display:grid;place-items:center;background:linear-gradient(145deg,#fff0e9,#ffe8f3 52%,#efe8ff);color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{width:min(100%,440px);overflow:hidden;border:1px solid rgba(255,255,255,.7);border-radius:28px;background:rgba(255,255,255,.96);box-shadow:0 22px 65px rgba(100,35,92,.18)}
.cover{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:var(--grad)}.fallback{display:grid;place-items:center;color:#fff;font-size:76px}
.body{padding:24px}.eyebrow{margin-bottom:8px;color:var(--purple);font-size:12px;font-weight:800;letter-spacing:.12em}h1{margin:0 0 10px;font-size:clamp(25px,8vw,34px);line-height:1.12}.desc{margin:0;color:var(--muted);line-height:1.55}
.stats{display:flex;gap:10px;margin:20px 0}.stat{flex:1;padding:13px;border-radius:15px;background:#f6f2fa;text-align:center}.stat b,.stat span{display:block}.stat b{font-size:20px}.stat span{margin-top:2px;color:var(--muted);font-size:12px}
button{width:100%;min-height:52px;border:0;border-radius:999px;background:var(--grad);color:#fff;font:inherit;font-weight:800;cursor:pointer}.help{display:block;margin-top:12px;color:#8b8495;font-size:12px;line-height:1.45;text-align:center}.wechat{display:none;margin:0 0 14px;padding:12px;border-radius:13px;background:#fff4d6;color:#6d4b00;font-size:13px;font-weight:650}.wechat.on{display:block}
</style>
</head>
<body>
<main>
${
  data.ogImage === OG_FALLBACK
    ? '<div class="cover fallback">🤙</div>'
    : `<img class="cover" src="${escapeAttribute(data.ogImage)}" alt="">`
}
<div class="body">
  <div class="eyebrow">${escapeHtml(eyebrow)}</div>
  <h1>${escapeHtml(data.title)}</h1>
  <p class="desc">${escapeHtml(displayDescription)}</p>
  <div class="stats">
    <div class="stat"><b>${data.checkins}</b><span>${escapeHtml(checkinLabel)}</span></div>
    <div class="stat"><b>${data.likes}</b><span>${escapeHtml(likeLabel)}</span></div>
  </div>
  <div class="wechat" id="wechat">${escapeHtml(wechat)}</div>
  <button id="open">${escapeHtml(openLabel)}</button>
  <small class="help">${escapeHtml(helper)}</small>
</div>
</main>
<script>
var WAVE_ID=${JSON.stringify(data.id)};
var APP_STORE=${JSON.stringify(APP_STORE)};
var PLAY_STORE=${JSON.stringify(PLAY_STORE)};
var ua=navigator.userAgent||"";
var store=/Android/i.test(ua)?PLAY_STORE:APP_STORE;
var isWeChat=/MicroMessenger/i.test(ua);
function openWave(){
  if(isWeChat){document.getElementById("wechat").classList.add("on");return;}
  var started=Date.now();
  var timer=setTimeout(function(){if(Date.now()-started<1800)location.href=store;},1250);
  window.addEventListener("pagehide",function(){clearTimeout(timer);},{once:true});
  document.addEventListener("visibilitychange",function(){if(document.hidden)clearTimeout(timer);},{once:true});
  location.href="loopii://wave/"+encodeURIComponent(WAVE_ID);
}
document.getElementById("open").addEventListener("click",openWave);
</script>
</body>
</html>`;
}
