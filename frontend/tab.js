/* 出海罗盘 · Tab 导航增强（滑动下划线指示器 + 键盘切换 + 面板高度兜底；零业务侵入，不碰 app.js / style.css） */

var tabIndicator = null;    // 滑动下划线（DOMContentLoaded 时注入 #tabs 尾部）
var lastSwitchTime = 0;     // 上次 Tab 切换时刻：入场动画 300ms 内跳过高度测量
var resizeTimer = null;     // resize debounce 句柄（100ms）
var mutTimer = null;        // 面板内容变化 debounce 句柄（60ms）

// ---------- 指示器定位：读 active 按钮 offsetLeft/offsetWidth 写 transform(translateX + scaleX)；rAF 包裹防首帧闪动 ----------
function positionIndicator() {
  requestAnimationFrame(function () {
    var active = document.querySelector(".tab-btn.active");
    if (!active || !tabIndicator) { return; }
    tabIndicator.style.transform = "translateX(" + active.offsetLeft + "px) scaleX(" + active.offsetWidth + ")";
  });
}

// ---------- 面板高度兜底：隐藏面板同帧临时 display:block 量真实折行高度（同步读写无渲染不闪），取最大写 min-height ----------
function measurePanelHeights() {
  var panels = document.querySelectorAll(".tab-panel");
  var maxH = 0;
  panels.forEach(function (p) {
    var wasHidden = !p.classList.contains("active");
    if (wasHidden) { p.style.display = "block"; }
    maxH = Math.max(maxH, p.offsetHeight);
    if (wasHidden) { p.style.display = ""; }
  });
  if (maxH > 0) { panels.forEach(function (p) { p.style.minHeight = maxH + "px"; }); }
}

// ---------- 切换登记：记录时刻（动画窗口）并重定位指示器 ----------
function markSwitched() {
  lastSwitchTime = Date.now();
  positionIndicator();
}

// ---------- 键盘切换：左右方向键循环切 Tab，焦点跟随（复用全局 switchTab，不重写切换逻辑） ----------
function onTabsKeydown(e) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") { return; }
  var btns = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
  var idx = btns.indexOf(document.activeElement);
  if (idx === -1) { return; }
  e.preventDefault();
  var next = e.key === "ArrowRight" ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
  btns[next].focus();
  switchTab(btns[next].dataset.tab);
  markSwitched();
}

// ---------- 内容重测：结果渲染/气泡重绘后面板变高，60ms 后立即兜底（不等下次切换那一刻才跳） ----------
function observePanels() {
  var observer = new MutationObserver(function () {
    clearTimeout(mutTimer);
    mutTimer = setTimeout(function () { positionIndicator(); measurePanelHeights(); }, 60);
  });
  document.querySelectorAll(".tab-panel").forEach(function (p) {
    observer.observe(p, { childList: true, subtree: true });
  });
}

// ---------- 初始化：注入指示器 + 绑定全部时机（初始/点击/键盘/resize/hashchange/字体/内容变化） ----------
document.addEventListener("DOMContentLoaded", function () {
  var tabs = document.getElementById("tabs");
  if (!tabs) { return; }
  tabIndicator = document.createElement("span");
  tabIndicator.className = "tab-indicator";
  tabs.appendChild(tabIndicator);
  positionIndicator();
  measurePanelHeights();
  // click 委托：内联 onclick 先执行（active 已切换），冒泡到 #tabs 时重定位指示器
  tabs.addEventListener("click", markSwitched);
  tabs.addEventListener("keydown", onTabsKeydown);
  // resize 100ms debounce：指示器总是重定位（验收：拉窄仍正确）；入场动画 300ms 内不测高
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      positionIndicator();
      if (Date.now() - lastSwitchTime > 300) { measurePanelHeights(); }
    }, 100);
  });
  // 进出 #/work 时 #main 才有尺寸（display:none 下 offsetLeft 无效）：视图切换后重定位 + 重测
  window.addEventListener("hashchange", function () {
    positionIndicator();
    if (Date.now() - lastSwitchTime > 300) { measurePanelHeights(); }
  });
  // 中英文字体加载完成后文本宽度变化：补一次定位，防首屏宽度差几像素
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(positionIndicator); }
  observePanels();
});