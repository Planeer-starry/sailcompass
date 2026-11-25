/* 出海罗盘 v1 · 导航增强：侧栏抽屉关闭、页面切换动画、生成完成后进入第一段
   - 路由与页面显隐在 router.js；这里只做不改变业务逻辑的体验层
*/

function closeDrawerIfMobile() {
  if (window.innerWidth <= 900 && typeof closeDrawer === "function") { closeDrawer(); }
}

function playPageEnter() {
  var target = document.getElementById("main");
  if (!target) { return; }
  target.classList.remove("page-enter");
  void target.offsetWidth;
  target.classList.add("page-enter");
  setTimeout(function () { target.classList.remove("page-enter"); }, 280);
}

// 四段生成完成后：如果还在总览页，进入第一段；已在分段页则不打断
function goFirstSection() {
  var h = location.hash;
  if (h === "#/report" || h === "" || h === "#/" || h === "#") {
    location.hash = "#/report/insight";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".side-item").forEach(function (item) {
    item.addEventListener("click", closeDrawerIfMobile);
  });
  // Alt + 1..5：快速切换四段与总览（不抢输入框焦点）
  document.addEventListener("keydown", function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) { return; }
    var map = { "1": "#/report", "2": "#/report/insight", "3": "#/report/listing", "4": "#/report/compliance", "5": "#/report/quality" };
    if (map[e.key]) { e.preventDefault(); location.hash = map[e.key]; }
  });
});

window.addEventListener("hashchange", function () {
  if (location.hash.indexOf("#/report/") === 0) { playPageEnter(); }
});