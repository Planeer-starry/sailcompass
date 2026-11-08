/* 出海罗盘 · 演示模式（零配置体验）：health 判定 → topbar 徽章 / 首页提示条 / 证据区灰字开关 */

var DEMO_BANNER_KEY = "sailcompass_demo_banner_dismissed";
window.demoMode = false;   // 全局标记：render.js 据此决定证据区是否加演示灰字

// ---------- 初始化：查 /api/health 的 demo_mode，仅演示模式才显示标识 ----------
function setupDemoMode() {
  fetch("/api/health").then(function (resp) { return resp.json(); }).then(function (health) {
    window.demoMode = !!health.demo_mode;
    if (!window.demoMode) { return; }
    document.getElementById("demo-badge").classList.remove("hidden");
    showDemoBanner();
  }).catch(function () {
    // 服务连不上时保持普通外观；真实错误由生成/问答流程统一提示，不在此重复弹窗
  });
}

// ---------- 首页提示条：关闭过就不再显示（localStorage 记忆） ----------
function showDemoBanner() {
  if (readDemoBannerDismissed()) { return; }
  document.getElementById("demo-banner").classList.remove("hidden");
}

function dismissDemoBanner() {
  writeDemoBannerDismissed();
  document.getElementById("demo-banner").classList.add("hidden");
}

function readDemoBannerDismissed() {
  try {
    return localStorage.getItem(DEMO_BANNER_KEY) === "1";
  } catch (e) {
    // 隐私模式禁用 localStorage：读失败按未关闭处理，本次仍显示提示条
    return false;
  }
}

function writeDemoBannerDismissed() {
  try {
    localStorage.setItem(DEMO_BANNER_KEY, "1");
  } catch (e) {
    // 存储不可用：关闭仅对当前页面有效，不阻断使用
  }
}

document.addEventListener("DOMContentLoaded", setupDemoMode);