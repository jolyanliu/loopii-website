// netlify/functions/event-preview.js
// Loopii event share preview - Netlify Function (classic handler format).
// Route: loopii.io/e/:id  (via netlify.toml redirect)
// Env vars: SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

const APP_STORE  = "https://apps.apple.com/app/id6760251930";
const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.huazhou.loopiiapp";
const OG_FALLBACK = "https://loopii.io/colorlogo.png";
const EVENT_BUCKET = "event-photos";
const TZ = "Australia/Sydney";

const DOT = "\u00B7";
const MDASH = "\u2014";
const ARROW = "\u203A";
const HAND = "\u261D\uFE0F";
const FOX = "\uD83E\uDD8A";
const KOALA = "\uD83D\uDC28";
const PANDA = "\uD83D\uDC3C";
const PARTY = "\uD83C\uDF89";
const SPEECH = "\uD83D\uDCAC";
const HEART = "\u2661";
const SHARE = "\u2197";
const TICKET = "\uD83C\uDF9F\uFE0F";

exports.handler = async (event) => {
  // event.path like /e/<id> or /.netlify/functions/event-preview
  // id can come from query (?id=) or last path segment
  const qsId = (event.queryStringParameters && event.queryStringParameters.id) || "";
  const pathParts = (event.path || "").split("/").filter(Boolean);
  const lastSeg = pathParts.length ? pathParts[pathParts.length - 1] : "";
  const id = qsId || (lastSeg === "event-preview" ? "" : lastSeg);

  const accept = (event.headers && (event.headers["accept-language"] || event.headers["Accept-Language"])) || "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return resp(notFoundPage(), 404);
  }

  const cols = [
    "id","title","description","location","event_time","interest","nickname",
    "avatar_index","image_url","title_translations","description_translations",
    "source_type","external_url","payment_method"
  ].join(",");

  let ev;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${id}&is_hidden=eq.false&select=${cols}&limit=1`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return resp(notFoundPage(), 404);
    ev = rows[0];
  } catch (e) {
    return resp(notFoundPage(), 404);
  }

  let going = null;
  try {
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/event_participants?event_id=eq.${id}&status=eq.approved&select=user_id`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
                   Prefer: "count=exact", Range: "0-0" } }
    );
    const crange = cr.headers.get("content-range");
    if (crange && crange.includes("/")) going = parseInt(crange.split("/")[1], 10);
  } catch (e) {}

  const lang  = pickLang(qsId, event.queryStringParameters, accept);
  const title = pickTr(ev.title_translations, lang) || ev.title || "Loopii";
  const desc  = pickTr(ev.description_translations, lang) || ev.description || "";

  const cover    = coverUrl(ev);
  const ogImage  = cover || OG_FALLBACK;
  const emoji    = interestEmoji(ev.interest);
  const when     = fmtTime(ev.event_time, lang);
  const pageUrl  = `https://loopii.io/e/${id}`;
  const isOfficial = ev.source_type && ev.source_type !== "loopii";
  const isTicketed = ev.payment_method === "external_ticket" && ev.external_url;
  const ogDesc   = buildOgDescription({ lang, when, location: ev.location, going, isTicketed });

  return resp(renderPage({
    lang, title, desc, when, location: ev.location, nickname: ev.nickname,
    cover, emoji, going, ogImage, ogDesc, pageUrl,
    interest: ev.interest || "", isOfficial, isTicketed, ticketUrl: ev.external_url
  }), 200);
};

/* ============================ helpers ============================ */

function pickLang(qsId, qs, accept) {
  const q = ((qs && qs.lang) || "").slice(0, 2).toLowerCase();
  const supported = ["en","zh","ja","ko","th","es","ar","fr","pt","de"];
  if (supported.includes(q)) return q;
  const al = (accept || "").toLowerCase();
  for (const code of supported) if (al.includes(code)) return code;
  return "en";
}

function pickTr(map, lang) {
  if (!map || typeof map !== "object") return null;
  return map[lang] || map.en || null;
}

function coverUrl(ev) {
  const v = ev.image_url;
  if (!v) return null;
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `${SUPABASE_URL}/storage/v1/object/public/${EVENT_BUCKET}/${v.replace(/^\/+/, "")}`;
}

function interestEmoji(interest) {
  if (!interest) return PARTY;
  const m = interest.match(/\p{Extended_Pictographic}/u);
  return m ? m[0] : PARTY;
}

function fmtTime(iso, lang) {
  try {
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-AU", {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: TZ
    }).format(new Date(iso));
  } catch (e) { return iso; }
}

function buildOgDescription({ lang, when, location, going, isTicketed }) {
  const parts = [];
  if (when) parts.push(when);
  if (location) parts.push(location);
  if (going && going > 0) {
    parts.push(lang === "zh" ? `${going} \u4EBA\u60F3\u53BB` : `${going} people going`);
  } else {
    parts.push(lang === "zh" ? "\u627E\u4EBA\u4E00\u8D77\u53BB" : "Find people to go with");
  }
  if (isTicketed) parts.push(lang === "zh" ? "\u53EF\u5728 Eventfinda \u8D2D\u7968" : "Tickets on Eventfinda");
  return clip(parts.join(` ${DOT} `), 160);
}

function clip(s, n) { s = (s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escA(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function resp(body, statusCode) {
  const clean = body.replace(/^\uFEFF/, "");
  return {
    statusCode: statusCode || 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    body: clean
  };
}

const T = {
  going:   { en: "going", zh: "\u60F3\u53BB" },
  autogrp: { en: "Group opens at 2", zh: "\u6EE1 2 \u4EBA\u81EA\u52A8\u5EFA\u7FA4" },
  joinOff: { en: "I'm in", zh: "\u6211\u4E5F\u53BB" },
  joinReg: { en: "Join event", zh: "\u6211\u4E5F\u53BB\u8FD9\u4E2A\u6D3B\u52A8" },
  tickets: { en: "Buy tickets", zh: "\u8D2D\u7968" },
  dockT:   { en: "Continue in Loopii", zh: "\u7EE7\u7EED\u5728 Loopii \u67E5\u770B" },
  dockS:   { en: `Join the chat ${DOT} Find people going`, zh: "\u62A5\u540D \u804A\u5929 \u627E\u4EBA\u4E00\u8D77\u53BB" },
  open:    { en: "Open", zh: "\u6253\u5F00" },
  getapp:  { en: "Open / Get app", zh: "\u6253\u5F00 / \u4E0B\u8F7D" },
  wx1:     { en: "Tap the menu, top-right", zh: "\u70B9\u51FB\u53F3\u4E0A\u89D2\u83DC\u5355" },
  wx2:     { en: "choose Open in Browser", zh: "\u9009\u62E9\u5728\u6D4F\u89C8\u5668\u6253\u5F00" },
  more:    { en: `Read more ${ARROW}`, zh: `\u5C55\u5F00\u5168\u6587 ${ARROW}` },
  official:{ en: "Official", zh: "\u5B98\u65B9\u6D3B\u52A8" },
  host:    { en: "Host", zh: "\u53D1\u8D77\u4EBA" }
};
const t = (k, lang) => (T[k] && (T[k][lang] || T[k].en)) || "";

function notFoundPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loopii</title></head>`
    + `<body style="font-family:system-ui;text-align:center;padding:60px 24px;color:#333">`
    + `<h2>Event not found</h2><p style="color:#888">This event may have ended or been removed.</p>`
    + `<a href="${APP_STORE}" style="color:#7B2FF2">Get Loopii</a></body></html>`;
}

function renderPage(d) {
  const dir = d.lang === "ar" ? "rtl" : "ltr";

  const coverBlock = d.cover
    ? `<img src="${escA(d.cover)}" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block">`
    : `<div class="cover"><span class="emoji">${esc(d.emoji)}</span></div>`;

  const faces = `<span>${FOX}</span><span>${KOALA}</span><span>${PANDA}</span>`;
  const goingLine = (d.going && d.going > 0)
    ? `<div class="attendees"><div class="faces">${faces}</div><p><b>${d.going}</b> ${esc(t("going", d.lang))} ${DOT} ${esc(t("autogrp", d.lang))}</p></div>`
    : `<div class="attendees"><div class="faces">${faces}</div><p>${esc(t("autogrp", d.lang))}</p></div>`;

  const ticketBtn = d.isTicketed
    ? `<a class="ticket" href="${escA(d.ticketUrl)}" target="_blank" rel="noopener">${TICKET} ${esc(t("tickets", d.lang))}</a>`
    : "";

  const joinLabel = d.isOfficial ? t("joinOff", d.lang) : t("joinReg", d.lang);
  const hostRole = d.isOfficial ? t("official", d.lang) : t("host", d.lang);

  const head = `<!doctype html>
<html lang="${esc(d.lang)}" dir="${dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="color-scheme" content="light only">
<meta property="og:type" content="website">
<meta property="og:title" content="${escA(d.title)}">
<meta property="og:description" content="${escA(d.ogDesc)}">
<meta property="og:image" content="${escA(d.ogImage)}">
<meta property="og:url" content="${escA(d.pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="apple-itunes-app" content="app-id=6760251930, app-argument=${escA(d.pageUrl)}">
<title>${esc(d.title)} ${MDASH} Loopii</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--dark:#0A0A0A;--white:#FAFAFA;--purple:#7B2FF2;--pink:#E040A0;--magenta:#C850C0;--grey:#888;--light:#F5F3F0;--line:rgba(0,0,0,.07);--grad:linear-gradient(135deg,#7B2FF2,#C850C0 50%,#E040A0)}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{color-scheme:light only}
body{font-family:'Poppins','PingFang SC',sans-serif;color:var(--dark);background:var(--white);line-height:1.5;padding-bottom:calc(84px + env(safe-area-inset-bottom))}
.wrap{max-width:480px;margin:0 auto;min-height:100vh;background:var(--white)}
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:rgba(250,250,250,.9);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:17px}
.brand .dot{width:22px;height:22px;border-radius:7px;object-fit:cover}
.topbar .open{background:var(--grad);color:#fff;border:none;font-family:inherit;font-weight:600;font-size:13px;padding:7px 16px;border-radius:30px;cursor:pointer}
.cover{position:relative;width:100%;aspect-ratio:16/10;background:var(--grad);display:flex;align-items:center;justify-content:center;overflow:hidden}
.cover .emoji{font-size:96px;filter:drop-shadow(0 6px 20px rgba(0,0,0,.25))}
.body{padding:20px 18px 8px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--purple);margin-bottom:8px}
h1{font-size:23px;font-weight:800;line-height:1.28;letter-spacing:-.3px;margin-bottom:16px}
.meta{display:flex;flex-direction:column;gap:12px;margin-bottom:18px}
.meta .row{display:flex;align-items:center;gap:12px;font-size:15px;color:#333}
.meta .ico{flex:none;width:38px;height:38px;border-radius:11px;background:var(--light);display:flex;align-items:center;justify-content:center;font-size:18px}
.host{display:flex;align-items:center;gap:11px;padding:14px;border:1px solid var(--line);border-radius:16px;margin-bottom:18px}
.host .av{width:42px;height:42px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;flex:none}
.host .who b{font-size:15px;font-weight:600}.host .who small{display:block;color:var(--grey);font-size:13px}
.attendees{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.faces{display:flex}.faces span{width:32px;height:32px;border-radius:50%;border:2px solid #fff;margin-left:-10px;display:flex;align-items:center;justify-content:center;font-size:15px;background:var(--light)}
.faces span:first-child{margin-left:0}.attendees p{font-size:14px;color:#333}
.desc{position:relative;font-size:15px;color:#333;line-height:1.7;max-height:118px;overflow:hidden;white-space:pre-wrap}
.desc::after{content:"";position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(transparent,var(--white))}
.more{display:inline-flex;align-items:center;gap:5px;margin-top:6px;background:none;border:none;font-family:inherit;font-size:14px;font-weight:600;color:var(--purple);cursor:pointer}
.actions{display:flex;align-items:center;gap:10px;padding:18px;border-top:1px solid var(--line);margin-top:16px}
.join{flex:1;background:var(--grad);color:#fff;border:none;font-family:inherit;font-weight:700;font-size:16px;padding:15px;border-radius:30px;cursor:pointer;box-shadow:0 6px 20px rgba(123,47,242,.28)}
.icbtn{width:50px;height:50px;flex:none;border:1.5px solid var(--line);background:#fff;border-radius:16px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ticket{display:block;text-align:center;margin:0 18px 4px;padding:13px;border:1.5px solid var(--purple);color:var(--purple);border-radius:30px;font-weight:600;font-size:15px;text-decoration:none}
.dock{position:fixed;bottom:0;left:0;right:0;z-index:40;max-width:480px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.92);backdrop-filter:blur(20px);border-top:1px solid var(--line)}
.dock .dot{width:38px;height:38px;border-radius:11px;object-fit:cover;flex:none}
.dock .txt{flex:1;line-height:1.3}.dock .txt b{font-size:15px;font-weight:700}.dock .txt small{display:block;color:var(--grey);font-size:12px}
.dock .go{background:var(--dark);color:#fff;border:none;font-family:inherit;font-weight:600;font-size:14px;padding:11px 20px;border-radius:30px;cursor:pointer;white-space:nowrap}
.wxmask{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.78);display:none;padding:24px;color:#fff}
.wxmask.on{display:block}.wxmask .arrow{position:absolute;top:8px;right:14px;font-size:40px}
.wxmask .tip{margin-top:64px;text-align:right;font-size:17px;line-height:1.7;font-weight:600}.wxmask .tip span{color:#FFD84D}
</style>
</head>`;

  const bodyHtml = `<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand"><img class="dot" src="https://loopii.io/colorlogo.png" alt="Loopii">Loopii</div>
    <button class="open" onclick="openApp()">${esc(t("open", d.lang))}</button>
  </div>
  ${coverBlock}
  <div class="body">
    <div class="eyebrow">${esc(d.interest)}</div>
    <h1>${esc(d.title)}</h1>
    <div class="meta">
      <div class="row"><span class="ico">\uD83D\uDCC5</span><div><b>${esc(d.when)}</b></div></div>
      ${d.location ? `<div class="row"><span class="ico">\uD83D\uDCCD</span><div><b>${esc(d.location)}</b></div></div>` : ""}
    </div>
    ${d.nickname ? `<div class="host"><span class="av">${esc(d.emoji)}</span><div class="who"><b>${esc(d.nickname)}</b><small>${esc(hostRole)}</small></div></div>` : ""}
    ${goingLine}
    ${d.desc ? `<div class="desc">${esc(d.desc)}</div><button class="more" onclick="openApp()">${esc(t("more", d.lang))}</button>` : ""}
  </div>
  ${ticketBtn}
  <div class="actions">
    <button class="join" onclick="openApp()">${esc(joinLabel)}</button>
    <button class="icbtn" onclick="openApp()">${SPEECH}</button>
    <button class="icbtn" onclick="openApp()">${HEART}</button>
    <button class="icbtn" onclick="openApp()">${SHARE}</button>
  </div>
</div>
<div class="dock">
  <img class="dot" src="https://loopii.io/colorlogo.png" alt="Loopii">
  <div class="txt"><b>${esc(t("dockT", d.lang))}</b><small>${esc(t("dockS", d.lang))}</small></div>
  <button class="go" onclick="openApp()">${esc(t("getapp", d.lang))}</button>
</div>
<div class="wxmask" id="wxmask" onclick="this.classList.remove('on')">
  <div class="arrow">${HAND}</div>
  <div class="tip">${esc(t("wx1", d.lang))}<br><span>${esc(t("wx2", d.lang))}</span></div>
</div>
<script>
var APP_STORE="${APP_STORE}", PLAY_STORE="${PLAY_STORE}";
var ua=navigator.userAgent||"";
var isAndroid=ua.indexOf("Android")>-1;
var isWX=ua.indexOf("MicroMessenger")>-1;
var STORE_URL=isAndroid?PLAY_STORE:APP_STORE;
function openApp(){
  if(isWX){document.getElementById('wxmask').classList.add('on');return;}
  location.href=STORE_URL;
}
</script>
</body>
</html>`;

  return head + bodyHtml;
}
