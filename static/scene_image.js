/* 出海罗盘 · 场景图模块（阶段 5：Listing Tab 下方独立卡片；失败/未配置均不影响其他 Tab） */

var SCENE_LABELS = { outdoor: "户外", home: "家居", gift: "礼品" }; // 与后端白名单一致
var selectedScene = "outdoor";   // 当前选中场景（默认户外）
var imageConfigured = false;     // health 查询结果：未确认前一律按禁用处理
var sceneDemoMode = false;       // health 返回的演示模式：生图直接返回内置示例图
var generatingImage = false;     // 生成中：忽略重复点击
var currentImageSrc = "";        // 当前展示图（本地落盘路径 / data URL / 远程 url / 示例图路径）
var currentImageIsDemo = false;  // true = 内置示例图（演示模式）或接口失败后的兜底图
var currentImageLocal = false;   // true = 后端已落盘的本地路径（同源，下载必成功）

// ---------- 初始化：查 /api/health 的 image_configured 决定卡片可用态 ----------
function setupSceneImage() {
  fetch("/api/health").then(function (resp) { return resp.json(); }).then(function (health) {
    sceneDemoMode = !!health.demo_mode;
    applyImageConfigured(sceneDemoMode || !!health.image_configured);
  }).catch(function () {
    // 本地服务连不上时按未配置兜底（此时主流程同样不可用）
    applyImageConfigured(false);
  });
}

function applyImageConfigured(configured) {
  imageConfigured = configured;
  document.getElementById("scene-unconfigured").classList.toggle("hidden", configured);
  setSceneButtonsDisabled(!configured || generatingImage);
}

function setSceneButtonsDisabled(disabled) {
  document.querySelectorAll(".scene-btn").forEach(function (b) { b.disabled = disabled; });
  document.getElementById("btn-gen-image").disabled = disabled;
}

// ---------- 场景选择：三选一，切换 active ----------
function selectScene(btn) {
  if (generatingImage) { return; }
  selectedScene = btn.dataset.scene;
  document.querySelectorAll(".scene-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
}

// ---------- 生成：POST /api/generate-image；400 与接口错误统一走 error 通道 ----------
function generateSceneImage() {
  if (generatingImage) { return; }
  var product = document.getElementById("product").value.trim();
  if (!product) { showToast("请先填写产品名称"); return; }
  hideSceneError();
  setGeneratingImage(true);
  fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product: product, scene: selectedScene }),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    setGeneratingImage(false);
    if (res.data.error) { showSceneError(res.data.error); return; }
    showSceneResult(res.data);
  }).catch(function () {
    setGeneratingImage(false);
    showSceneError("网络异常，无法连接生图服务");
  });
}

// ---------- 生成中态：按钮全禁用 + 按钮内转圈 + 预计耗时提示 ----------
function setGeneratingImage(loading) {
  generatingImage = loading;
  setSceneButtonsDisabled(loading || !imageConfigured);
  var icon = document.getElementById("btn-gen-image-icon");
  icon.textContent = loading ? "⟳" : "🎨";
  icon.classList.toggle("spin", loading);
  document.getElementById("btn-gen-image-label").textContent = loading ? "生成中…" : "生成场景图";
  var status = document.getElementById("scene-status");
  status.textContent = sceneDemoMode ? "演示模式：正在载入内置示例图…" : "正在生成，约 10–30 秒";
  status.classList.toggle("hidden", !loading);
  document.getElementById("scene-loading").classList.toggle("hidden", !loading);
}

// ---------- 成功：直接展示落盘原图（服务商水印保留，页面 CSS 角标标识 AI 生成）----------
// 通道优先级：本地落盘路径 > data URL > 远程 URL（远程带 Expires，仅落盘失败时的降级显示）
function showSceneResult(data) {
  var src = data.image_path || data.image_b64 || data.image_url;
  if (!src) { showSceneError("生图接口未返回图片数据"); return; }
  currentImageSrc = src;
  currentImageLocal = !!data.image_path;
  currentImageIsDemo = !!data.demo;
  document.getElementById("scene-badge").textContent = data.demo
    ? "内置示例图 · 需人工审核"
    : "AI 生成 · 需人工审核";
  showSceneImage();
}

function showSceneImage() {
  document.getElementById("scene-img").src = currentImageSrc;
  document.getElementById("scene-loading").classList.add("hidden");
  document.getElementById("scene-result").classList.remove("hidden");
}

// ---------- 失败：错误条 + 重试；同时兜底显示示例图（角标改「示例图」留痕，不伪装实拍） ----------
function showSceneError(msg) {
  document.getElementById("scene-error-msg").textContent = "生成失败：" + msg;
  document.getElementById("scene-error").classList.remove("hidden");
  currentImageSrc = "/static/demo_images/" + selectedScene + ".png";
  currentImageLocal = true;
  currentImageIsDemo = true;
  document.getElementById("scene-badge").textContent = "示例图 · AI 生成 · 需人工审核";
  showSceneImage();
}

function hideSceneError() {
  document.getElementById("scene-error").classList.add("hidden");
}

// ---------- 下载：本地路径同源直下（必成功）；其余 fetch 转 Blob，跨域被拦时新窗口兜底；文件名带 AI生成/示例图 标识 ----------
// 扩展名跟随落盘文件真实格式（后端已按内容嗅探：jpeg 内容落 .jpg）；后缀与内容不符 Windows 照片查看器会拒开
function downloadSceneImage() {
  if (!currentImageSrc) { return; }
  var suffix = currentImageIsDemo ? "示例图" : "AI生成";
  var filename = "场景图_" + SCENE_LABELS[selectedScene] + "_" + suffix + sceneFileExt();
  if (currentImageLocal) { triggerDownload(currentImageSrc, filename); return; }
  fetch(currentImageSrc).then(function (resp) { return resp.blob(); }).then(function (blob) {
    triggerDownload(URL.createObjectURL(blob), filename);
  }).catch(function () {
    showToast("图片跨域无法直接下载，已在新窗口打开");
    window.open(currentImageSrc, "_blank");
  });
}

// 从当前图地址提取真实扩展名；提不出默认 .png
function sceneFileExt() {
  var m = /\.(jpg|jpeg|png)/i.exec(currentImageSrc.split("?")[0]);
  return m ? "." + m[1].toLowerCase() : ".png";
}

function triggerDownload(href, filename) {
  var a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  if (href.indexOf("blob:") === 0) {
    setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
  }
}

document.addEventListener("DOMContentLoaded", function () { setupSceneImage(); });