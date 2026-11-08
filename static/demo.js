/* 出海罗盘 · 演示模式（零配置体验 + 手动切换）
   - 模式来源：后端 .env 自动判定 / 前端 localStorage 强制（强制优先）
   - 强制演示时在脚本顶层劫持 window.fetch，给同源 /api/ 请求加 X-Force-Mode: demo
   - 顶部切换按钮由本脚本动态注入，不改 index.html */

var FORCE_KEY = "sailcompass_force_demo";
var DEMO_BANNER_KEY = "sailcompass_demo_banner_dismissed";
var originalFetch = window.fetch.bind(window);   // 保存原始 fetch：包装层与切换探测都用它
window.demoMode = false;                          // 当前是否为演示模式（含强制）
window.demoModeSource = "auto";                   // forced / auto

// ---------- fetch 劫持：只包同源 /api/，保留原 headers / body / Request 语义 ----------
function isApiUrl(input) {
  var raw = typeof input === "string" ? input
    : (input instanceof Request ? input.url : String(input));
  try {
    var url = new URL(raw, location.href);
    return url.origin === location.origin && url.pathname.indexOf("/api/") === 0;
  } catch (e) {
    return false;
  }
}

function installForceDemoFetch() {
  if (window.__forceDemoFetchInstalled) { return; }
  window.__forceDemoFetchInstalled = true;
  window.fetch = function (input, init) {
    if (!isApiUrl(input)) { return originalFetch(input, init); }
    if (input instanceof Request) {
      var reqHeaders = new Headers(input.headers);
      reqHeaders.set("X-Force-Mode", "demo");
      return originalFetch(new Request(input, { headers: reqHeaders }));
    }
    var nextInit = Object.assign({}, init || {});
    var headers = new Headers(nextInit.headers || {});
    headers.set("X-Force-Mode", "demo");
    nextInit.headers = headers;
    return originalFetch(input, nextInit);
  };
}

// 顶层同步安装：必须早于 scene_image.js 等脚本的 DOMContentLoaded health 请求
if (readForceDemo()) { installForceDemoFetch(); }

// ---------- 初始化：health 判定当前模式 → 注入按钮 / 显示提示条 ----------
function setupDemoMode() {
  removeLegacyBadge();
  requestHealth().then(function (health) {
    applyModeState(health);
    injectModeToggle();
    onRouteChange();
  }).catch(function () {
    // 服务连不上时不注入按钮，避免误导；具体错误由生成/问答流程提示
  });
}

function requestHealth() {
  return window.fetch("/api/health").then(function (resp) { return resp.json(); });
}

function requestHealthRaw() {
  // 切换探测用原始 fetch：避免强制头影响自动判定的读取
  return originalFetch("/api/health").then(function (resp) { return resp.json(); });
}

function applyModeState(health) {
  window.demoMode = !!health.demo_mode;
  window.demoModeSource = health.mode_source || "auto";
  if (window.demoMode) { showDemoBanner(); }
}

// ---------- 删除旧的独立徽章：切换按钮成为唯一模式标识 ----------
function removeLegacyBadge() {
  var badge = document.getElementById("demo-badge");
  if (badge) { badge.remove(); }
}

// ---------- 切换按钮：插在产品名之后，28px 胶囊 ----------
function injectModeToggle() {
  var brand = document.querySelector(".topbar-brand");
  if (!brand || document.getElementById("mode-toggle")) { return; }
  var btn = document.createElement("button");
  btn.id = "mode-toggle";
  btn.type = "button";
  btn.className = "mode-toggle";
  btn.title = "点击切换模式";
  btn.addEventListener("click", onToggleMode);
  brand.insertAdjacentElement("afterend", btn);
  renderModeToggle();
}

function renderModeToggle() {
  var btn = document.getElementById("mode-toggle");
  if (!btn) { return; }
  var demo = window.demoMode;
  btn.classList.toggle("is-demo", demo);
  btn.classList.toggle("is-normal", !demo);
  btn.innerHTML = demo
    ? '<span class="mode-toggle-emoji">🧪</span><span class="mode-toggle-text">演示模式</span><span class="mode-toggle-icon">⇄</span>'
    : '<span class="mode-toggle-emoji">🟢</span><span class="mode-toggle-text">正常模式</span><span class="mode-toggle-icon">⇄</span>';
}

// ---------- 切换：演示 → 正常需先确认已配置；正常 → 演示直接写标记 ----------
function onToggleMode() {
  if (window.demoMode) { switchToNormal(); }
  else { switchToDemo(); }
}

function switchToDemo() {
  try {
    localStorage.setItem(FORCE_KEY, "1");
    localStorage.removeItem(DEMO_BANNER_KEY);   // 切过去先让提示条出现
  } catch (e) {
    toast("浏览器存储不可用，无法保持演示模式");
    return;
  }
  location.reload();
}

function switchToNormal() {
  requestHealthRaw().then(function (health) {
    if (!health.text_configured) {
      toast("请先配置模型服务；未配置时将保持演示模式");
      location.hash = "#/settings";
      showSettingsDemoTip();
      return;
    }
    try {
      localStorage.removeItem(FORCE_KEY);
    } catch (e) {
      toast("浏览器存储不可用，无法切回正常模式");
      return;
    }
    location.reload();
  }).catch(function () {
    toast("无法检测模型配置，请稍后重试");
  });
}

// ---------- 首页浅黄提示条：只在真正演示模式时显示 ----------
function showDemoBanner() {
  if (readDemoBannerDismissed()) { return; }
  var banner = document.getElementById("demo-banner");
  if (banner) { banner.classList.remove("hidden"); }
}

function dismissDemoBanner() {
  writeDemoBannerDismissed();
  var banner = document.getElementById("demo-banner");
  if (banner) { banner.classList.add("hidden"); }
}

function readDemoBannerDismissed() {
  try { return localStorage.getItem(DEMO_BANNER_KEY) === "1"; }
  catch (e) { return false; }   // 隐私模式读失败：本次仍显示提示条
}

function writeDemoBannerDismissed() {
  try { localStorage.setItem(DEMO_BANNER_KEY, "1"); }
  catch (e) { /* 存储不可用：关闭仅对当前页面有效 */ }
}

function readForceDemo() {
  try { return localStorage.getItem(FORCE_KEY) === "1"; }
  catch (e) { return false; }
}

// ---------- 设置页橙色提示条：切正常失败或直接访问设置页时显示 ----------
function showSettingsDemoTip() {
  var view = document.getElementById("view-settings");
  if (!view || document.getElementById("settings-demo-tip")) { return; }
  var tip = document.createElement("div");
  tip.id = "settings-demo-tip";
  tip.className = "settings-demo-tip";
  tip.innerHTML =
    "<p>当前未检测到模型服务配置，请按下面的步骤填写后重启服务。在此之前，产品将以演示模式运行。</p>" +
    '<p class="settings-demo-tip-hint">当前可在项目根目录 <code>.env</code> 填写 ' +
    "<code>API_BASE_URL</code> / <code>API_KEY</code> / <code>MODEL</code> 后重启服务；" +
    "配置完成后点顶部开关切回正常模式。</p>";
  var wrap = view.querySelector(".home-wrap") || view;
  wrap.insertBefore(tip, wrap.firstChild);
}

function onRouteChange() {
  if (location.hash === "#/settings" && window.demoMode) { showSettingsDemoTip(); }
}

function toast(msg) {
  if (typeof showToast === "function") { showToast(msg); }
  else { console.warn(msg); }
}

document.addEventListener("DOMContentLoaded", setupDemoMode);
window.addEventListener("hashchange", onRouteChange);