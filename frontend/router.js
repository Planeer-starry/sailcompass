/* 出海罗盘 v1 · 路由：首页 / 出海报告总览 / 四段独立页 / 聆听您的声音 / 新手引导 / 设置
   - 总览保留左侧四段导航；进入任意分段后隐藏侧栏，整页只排版这一段
   - 顶部横条始终固定，返回按钮随路由变化
*/

var REPORT_SECTIONS = ["insight", "listing", "compliance", "quality"];
var SECTION_TITLES = {
  insight: "市场洞察",
  listing: "上架文案（中文）",
  compliance: "合规体检",
  quality: "交叉质检"
};

// ---------- 解析 hash：返回 home / report / report-xxx / ask / help / settings ----------
function parseHash() {
  var h = location.hash.replace(/^#\/?/, "");
  if (h === "" || h === "/") { return "home"; }
  if (h === "report") { return "report"; }
  if (h.indexOf("report/") === 0) {
    var section = h.slice("report/".length);
    return REPORT_SECTIONS.indexOf(section) !== -1 ? "report-" + section : null;
  }
  if (h === "ask" || h === "help" || h === "about" || h === "translate" || h === "image" || h === "settings") { return h; }
  return null;
}

function viewIdForRoute(route) {
  if (route === "home") { return "view-home"; }
  if (route === "ask") { return "view-ask"; }
  if (route === "help") { return "view-help"; }
  if (route === "about") { return "view-about"; }
  if (route === "translate") { return "view-translate"; }
  if (route === "image") { return "view-image"; }
  if (route === "settings") { return "view-settings"; }
  return "main";
}

// ---------- 应用路由：显隐视图 + 侧栏 + 分段面板 + 顶部返回 + 动画 ----------
function applyRouteNow() {
  var route = parseHash();
  if (!route) {
    history.replaceState(null, "", location.pathname + "#/");
    route = "home";
  }
  if (route === "help" && typeof renderHelp === "function") { renderHelp(); }
  if (route === "settings" && typeof renderSettings === "function") { renderSettings(); }

  var viewId = viewIdForRoute(route);
  document.querySelectorAll(".view").forEach(function (view) {
    view.classList.toggle("view-active", view.id === viewId);
  });

  var bodyRoutes = ["home", "report", "report-insight", "report-listing", "report-compliance", "report-quality", "ask", "help", "about", "translate", "image", "settings"];
  document.body.classList.remove.apply(document.body.classList, bodyRoutes.map(function (r) { return "route-" + r; }));
  document.body.classList.add("route-" + route);

  if (route === "report") {
    document.querySelectorAll(".tab-panel").forEach(function (panel) { panel.classList.remove("active"); });
    updateSideActive("overview");
    setTopReturn("← 返回首页", "#/");
    document.title = "出海罗盘 SailCompass · 出海四项报告";
  } else if (route.indexOf("report-") === 0) {
    var section = route.slice("report-".length);
    if (typeof switchTab === "function") { switchTab(section); }
    if (section === "listing" && typeof updateTranslationLanguages === "function") { updateTranslationLanguages(); }
    updateSideActive(section);
    setTopReturn("← 返回出海报告", "#/report");
    document.title = "出海罗盘 SailCompass · " + (SECTION_TITLES[section] || "出海报告");
  } else if (route === "translate") {
    updateSideActive("translate");
    setTopReturn("← 返回首页", "#/");
    document.title = "出海罗盘 SailCompass · 多语翻译";
    if (typeof initTranslatePage === "function") { initTranslatePage(); }
  } else if (route === "image") {
    updateSideActive("image");
    setTopReturn("← 返回首页", "#/");
    document.title = "出海罗盘 SailCompass · 智能生图";
  } else {
    updateSideActive(null);
    setTopReturn("← 返回首页", "#/");
    if (route === "ask" && typeof openAskPanel === "function") { openAskPanel(); }
    document.title = route === "ask" ? "出海罗盘 SailCompass · 聆听您的声音"
      : route === "help" ? "出海罗盘 SailCompass · 新手引导"
      : route === "settings" ? "出海罗盘 SailCompass · 设置"
      : "出海罗盘 SailCompass · 出海第一步";
  }

  window.scrollTo({ top: 0, behavior: "instant" });
  updateNavActive(route);
  updateResumeBar();
  if (typeof closeDrawer === "function") { closeDrawer(); }
}

// ---------- 顶部横条返回：首页隐藏；报告总览返回首页；分段页返回报告 ----------
function setTopReturn(text, href) {
  var el = document.getElementById("top-return");
  if (!el) { return; }
  if (parseHash() === "home") { el.style.display = "none"; return; }
  el.style.display = "inline-flex";
  el.textContent = text;
  el.href = href;
}

// ---------- 顶部功能入口高亮：报告总览与四段都算「出海报告」 ----------
function updateNavActive(route) {
  var key = route === "report" || route.indexOf("report-") === 0 ? "report" : route;
  document.querySelectorAll(".topbar-link").forEach(function (link) {
    link.classList.toggle("active", link.dataset.nav === key);
  });
}

// ---------- 左侧导航高亮 ----------
function updateSideActive(section) {
  document.querySelectorAll(".side-item").forEach(function (item) {
    item.classList.toggle("is-active", item.dataset.section === section);
  });
}

// ---------- 首页「继续上次报告」横条：有结果才显示 ----------
function updateResumeBar() {
  var bar = document.getElementById("resume-bar");
  if (!bar) { return; }
  var r = window.lastResult;
  var hasResult = r && (r.insight || r.listing || r.compliance || r.quality);
  bar.classList.toggle("hidden", !hasResult);
  if (!hasResult) { return; }
  var name = document.getElementById("product") ? document.getElementById("product").value.trim() : "";
  bar.textContent = "📋 你上次生成的" + (name || "产品") + "报告还在，点这里继续查看 →";
  bar.href = "#/report";
}

// ---------- 打开某一段：整页跳转，不打断用户自己的点击节奏 ----------
function openSection(name) {
  if (!name || name === "overview") { location.hash = "#/report"; return; }
  location.hash = "#/report/" + name;
}

function goTab(name) { openSection(name); }

// ---------- Hero 主按钮：进报告总览并开始生成 ----------
function startDiagnosis() {
  location.hash = "#/report";
  if (typeof generateAll === "function") { generateAll(); }
}

// ---------- Hero 次按钮：回首页并滚到流程说明 ----------
function scrollToSteps() {
  if (parseHash() !== "home") { location.hash = "#/"; }
  setTimeout(function () {
    var el = document.getElementById("home-steps");
    if (el) { el.scrollIntoView({ behavior: "smooth" }); }
  }, 60);
}

// ---------- 结果完成后的四段卡片状态 ----------
function renderCardStates(result) {
  REPORT_SECTIONS.forEach(function (key) {
    var el = document.getElementById("card-state-" + key);
    if (!el) { return; }
    var ok = result && result[key] && (key !== "compliance" || result[key].length);
    el.textContent = ok ? "已完成" : "待生成";
    el.classList.toggle("is-done", !!ok);
  });
}



function applyRoute() {
  applyRouteNow();
  var route = parseHash() || "home";
  var view = document.getElementById(viewIdForRoute(route));
  if (!view) { return; }
  if (view.animate) {
    view.animate(
      [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
      { duration: 320, easing: "cubic-bezier(0.22, 0.7, 0.3, 1)", fill: "both" }
    );
  } else {
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
    setTimeout(function () { view.classList.remove("view-enter"); }, 320);
  }
}

window.addEventListener("hashchange", applyRoute);
document.addEventListener("DOMContentLoaded", applyRoute);