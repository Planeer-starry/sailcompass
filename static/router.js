/* 出海罗盘 · hash 路由（三视图切换：#/ 首页、#/work 工作台、#/settings 设置占位；不拆多个 HTML 文件） */

// ---------- 视图注册表：hash 键 → 容器 id；work 视图直接复用现有 #main ----------
var ROUTES = { home: "view-home", work: "main", settings: "view-settings" };

// ---------- 解析 hash：空或 "#/" → 首页；合法键返回键名；非法返回 null ----------
function parseHash() {
  var h = location.hash.replace(/^#\/?/, "");
  if (h === "") { return "home"; }
  return ROUTES.hasOwnProperty(h) ? h : null;
}

// ---------- 应用路由：切视图 + body 路由类（驱动侧边栏/汉堡/topbar 显隐） ----------
function applyRoute() {
  var route = parseHash();
  if (!route) {
    // 非法 hash：静默纠回 #/（replaceState 不产生历史记录、不触发二次 hashchange）
    history.replaceState(null, "", location.pathname + "#/");
    route = "home";
  }
  Object.keys(ROUTES).forEach(function (key) {
    document.getElementById(ROUTES[key]).classList.toggle("view-active", key === route);
  });
  document.body.classList.remove("route-home", "route-work", "route-settings");
  document.body.classList.add("route-" + route);
  updateNavActive(route);
  updateResumeBar();
  closeDrawer();   // 兜底：小屏抽屉开着切视图时强制收起
  window.scrollTo(0, 0);   // 视图切换滚动复位（SPA 习惯：进新页从顶部开始）
}

// ---------- topbar 导航高亮：当前视图对应链接加深 ----------
function updateNavActive(route) {
  document.querySelectorAll(".topbar-link").forEach(function (link) {
    link.classList.toggle("active", link.dataset.nav === route);
  });
}

// ---------- 首页「继续上次结果」横条：有结果才显示；产品名取表单当前值，取不到写「上一次」 ----------
function updateResumeBar() {
  var bar = document.getElementById("resume-bar");
  var r = window.lastResult;
  var hasResult = r && (r.insight || r.listing || r.compliance || r.quality);
  bar.classList.toggle("hidden", !hasResult);
  if (!hasResult) { return; }
  var name = document.getElementById("product").value.trim() || "上一次";
  bar.textContent = "📋 你上次生成的" + name + "报告还在，点这里继续查看 →";
}

// ---------- 首页能力卡：跳工作台并切到对应 Tab（视图切换由 hashchange 完成） ----------
function goTab(tab) {
  location.hash = "#/work";
  switchTab(tab);
}

// ---------- Hero 主按钮：跳工作台并直接触发生成 ----------
function startDiagnosis() {
  location.hash = "#/work";
  generateAll();
}

// ---------- Hero 次按钮：平滑滚动到流程说明块 ----------
function scrollToSteps() {
  document.getElementById("home-steps").scrollIntoView({ behavior: "smooth" });
}

window.addEventListener("hashchange", applyRoute);
document.addEventListener("DOMContentLoaded", applyRoute);