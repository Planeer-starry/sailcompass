/* 出海罗盘 · 交互脚本（阶段 2：纯前端演示，不接后端） */

// ---------- Tab 切换：按钮与面板一一对应 ----------
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(function (panel) {
    panel.classList.toggle("active", panel.id === "panel-" + name);
  });
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
}

// ---------- 抽屉（≤768px）：汉堡开 / 遮罩或汉堡关 ----------
function toggleDrawer() {
  if (document.getElementById("sidebar").classList.contains("open")) { closeDrawer(); }
  else { openDrawer(); }
}
function openDrawer() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("overlay").classList.remove("hidden");
}
function closeDrawer() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.add("hidden");
}

// ---------- 目标语言多选：最多 3 个，超限给行内提示 ----------
function toggleLang(btn) {
  var selected = document.querySelectorAll(".lang-btn.active").length;
  if (!btn.classList.contains("active") && selected >= 3) {
    showLangTip("最多选择 3 种语言");
    return;
  }
  btn.classList.toggle("active");
  hideLangTip();
}
function showLangTip(msg) {
  var tip = document.getElementById("lang-tip");
  tip.textContent = msg;
  tip.classList.remove("hidden");
}
function hideLangTip() {
  document.getElementById("lang-tip").classList.add("hidden");
}

// ---------- 合规审核联动：勾选 → 可标记 → 标记后导出启用；取消勾选全部复位 ----------
function onReviewCheck() {
  var checked = document.getElementById("review-check").checked;
  document.getElementById("btn-mark").disabled = !checked;
  if (!checked) { resetReview(); }
}
function markReviewed() {
  var btn = document.getElementById("btn-mark");
  btn.disabled = true;
  btn.textContent = "✅ 已审核";
  document.getElementById("btn-export-compliance").disabled = false;
}
function resetReview() {
  var btn = document.getElementById("btn-mark");
  btn.disabled = true;
  btn.textContent = "标记为已审核";
  document.getElementById("btn-export-compliance").disabled = true;
}

// ---------- 图片上传区（纯 UI 预览，不发给后端） ----------
function setupUpload() {
  var zone = document.getElementById("upload-zone");
  var input = document.getElementById("image-input");
  zone.addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function () {
    if (input.files[0]) { previewImage(input.files[0]); }
  });
  zone.addEventListener("dragover", function (e) {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", function () { zone.classList.remove("dragover"); });
  zone.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("dragover");
    var file = e.dataTransfer.files[0];
    if (file && file.type.indexOf("image/") === 0) { previewImage(file); }
    else { showToast("请选择图片文件"); }
  });
}
function previewImage(file) {
  document.getElementById("image-preview").src = URL.createObjectURL(file);
  document.getElementById("upload-empty").classList.add("hidden");
  document.getElementById("upload-filled").classList.remove("hidden");
}
function resetUpload() {
  document.getElementById("image-input").value = "";
  document.getElementById("upload-empty").classList.remove("hidden");
  document.getElementById("upload-filled").classList.add("hidden");
}

// ---------- toast：顶部居中，2 秒自动消失 ----------
var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.add("hide"); }, 2000);
}

// ---------- 假按钮：演示模式提示（阶段 3 接入真实逻辑） ----------
function demoAction() {
  showToast("演示模式：该功能将在阶段 3 接入");
}

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", function () {
  setupUpload();
  switchTab("insight");
});