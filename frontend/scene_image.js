/* 出海罗盘 · 02 生图模块：商品主图 / 详情长图 / 场景图；左侧描述与参考图，右侧出图 */

var SCENE_LABELS = { outdoor: "户外", home: "家居", gift: "礼品" };
var SCENE_KIND_LABELS = { main: "商品主图", detail: "详情长图", detail_square: "详情方图", scene: "场景图", other: "其他图型" };
var selectedScene = "outdoor";
var imageConfigured = false;
var sceneDemoMode = false;
var generatingImage = false;
var currentImageSrc = "";
var currentImageIsDemo = false;
var currentImageLocal = false;
var sceneReferenceData = "";
var sceneHistory = [];
var SCENE_HISTORY_LIMIT = 60;

function setupSceneImage() {
  setupSceneReference();
  setupSceneKindOther();
  fetch("/api/health").then(function (resp) { return resp.json(); }).then(function (health) {
    sceneDemoMode = !!health.demo_mode || !health.image_configured;
    applyImageConfigured(true);
  }).catch(function () {
    applyImageConfigured(false);
  });
}

function setupSceneReference() {
  var zone = document.getElementById("scene-ref-zone");
  var input = document.getElementById("scene-ref-input");
  if (!zone || !input || zone.dataset.ready === "1") { return; }
  zone.dataset.ready = "1";
  zone.addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function () {
    handleSceneReference(input.files && input.files[0]);
  });
}

function handleSceneReference(file) {
  if (!file) { return; }
  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    showToast("参考图只支持 JPG / PNG");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("参考图不能超过 8MB");
    return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    sceneReferenceData = String(reader.result || "");
    document.getElementById("scene-ref-preview").src = sceneReferenceData;
    document.getElementById("scene-ref-empty").classList.add("hidden");
    document.getElementById("scene-ref-filled").classList.remove("hidden");
    showToast("参考图已上传，生成时会结合描述使用");
  };
  reader.readAsDataURL(file);
}

function resetSceneReference() {
  sceneReferenceData = "";
  var input = document.getElementById("scene-ref-input");
  if (input) { input.value = ""; }
  var empty = document.getElementById("scene-ref-empty");
  var filled = document.getElementById("scene-ref-filled");
  if (empty) { empty.classList.remove("hidden"); }
  if (filled) { filled.classList.add("hidden"); }
}

function applyImageConfigured(configured) {
  imageConfigured = configured;
  var tip = document.getElementById("scene-unconfigured");
  if (tip) { tip.classList.toggle("hidden", configured); }
  setSceneButtonsDisabled(!configured || generatingImage);
}

function setSceneButtonsDisabled(disabled) {
  document.querySelectorAll(".scene-btn").forEach(function (b) { b.disabled = disabled; });
  var btn = document.getElementById("btn-gen-image");
  if (btn) { btn.disabled = disabled; }
}

function selectScene(btn) {
  if (generatingImage) { return; }
  selectedScene = btn.dataset.scene;
  document.querySelectorAll(".scene-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
}


function generateSceneImage() {
  var productEl = document.getElementById("scene-product");
  var fallback = document.getElementById("product");
  var product = (productEl ? productEl.value.trim() : (fallback ? fallback.value.trim() : ""));
  if (!product) {
    showRequiredModal("⚠️ 还差一步", "请先填写产品名称，这是生图的必要信息。", "scene-product");
    return;
  }
  var desc = document.getElementById("scene-desc");
  var text = desc ? desc.value.trim() : "";
  var notice = document.getElementById("scene-missing-notice");
  if (!text && !sceneReferenceData) {
    if (notice) { notice.classList.remove("hidden"); }
    return;
  }
  if (notice) { notice.classList.add("hidden"); }
  doGenerateSceneImage();
}

function fillSceneMissing() {
  var notice = document.getElementById("scene-missing-notice");
  if (notice) { notice.classList.add("hidden"); }
  var el = document.getElementById("scene-desc");
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flashField("scene-desc");
    setTimeout(function () { el.focus(); }, 350);
  }
}

function sceneGenerateAnyway() {
  var notice = document.getElementById("scene-missing-notice");
  if (notice) { notice.classList.add("hidden"); }
  doGenerateSceneImage();
}

function doGenerateSceneImage() {
  if (generatingImage) { return; }
  var productEl = document.getElementById("scene-product");
  var fallback = document.getElementById("product");
  var product = (productEl ? productEl.value.trim() : (fallback ? fallback.value.trim() : ""));
  if (!product) { showToast("请先填写产品名称"); return; }
  var kindEl = document.getElementById("scene-kind");
  var descEl = document.getElementById("scene-desc");
  var kind = kindEl ? kindEl.value : "scene";
  var description = descEl ? descEl.value.trim() : "";
  var countEl = document.getElementById("scene-count");
  var count = countEl ? Math.max(1, Math.min(6, parseInt(countEl.value || "1", 10))) : 1;
  if (sceneHistory.length + count > SCENE_HISTORY_LIMIT) {
    showSceneLimitModal(sceneHistory.length, count);
    return;
  }
  if (kind === "other") {
    var otherType = document.getElementById("scene-kind-other");
    if (otherType && otherType.value.trim()) { description = "自定义图型：" + otherType.value.trim() + "。" + description; }
  }
  hideSceneError();
  setGeneratingImage(true);
  fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product: product,
      scene: selectedScene,
      description: description,
      image_kind: kind,
      reference_image: sceneReferenceData,
      count: count
    })
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

function setGeneratingImage(loading) {
  generatingImage = loading;
  setSceneButtonsDisabled(loading || !imageConfigured);
  var icon = document.getElementById("btn-gen-image-icon");
  if (icon) {
    icon.textContent = loading ? "⟳" : "🎨";
    icon.classList.toggle("spin", loading);
  }
  var label = document.getElementById("btn-gen-image-label");
  if (label) { label.textContent = loading ? "生成中…" : "生成图片"; }
  var status = document.getElementById("scene-status");
  if (status) {
    status.textContent = sceneDemoMode ? "演示模式：正在载入内置示例图…" : "正在生成，约 10–30 秒";
    status.classList.toggle("hidden", !loading);
  }
  var loadingEl = document.getElementById("scene-loading");
  if (loadingEl) { loadingEl.classList.toggle("hidden", !loading); }
  if (loading && typeof setAgentState === "function") { setAgentState("image", "active"); }
}

function showSceneResult(data) {
  var items = data.images || [data];
  var added = 0;
  items.forEach(function (item) {
    var src = item.url || item.image_path || item.image_b64 || item.image_url;
    if (!src) { return; }
    sceneHistory.push({ src: src, local: !!(item.url || item.image_path), demo: !!item.demo, selected: false });

    added++;
  });
  if (!added) { showSceneError("生图接口未返回图片数据"); return; }
  selectSceneHistory(sceneHistory.length - 1);
  renderSceneHistory();
  if (typeof setAgentState === "function") { setAgentState("image", "done"); }
}

function renderSceneHistory() {
  var box = document.getElementById("scene-history");
  var list = document.getElementById("scene-history-list");
  if (!box || !list) { return; }
  if (!sceneHistory.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  var title = box.querySelector(".scene-history-title");
  if (title) { title.textContent = "生成过的图片（" + sceneHistory.length + "/" + SCENE_HISTORY_LIMIT + " 张，勾选可批量处理）"; }
  list.innerHTML = sceneHistory.map(function (item, index) {
    return '<div class="scene-history-item' + (item.src === currentImageSrc ? ' current' : '') + '">' +
      '<label class="scene-history-check"><input type="checkbox"' + (item.selected ? ' checked' : '') +
        ' onchange="toggleSceneHistorySelect(' + index + ', this.checked)"></label>' +
      '<img src="' + item.src + '" alt="历史图片 ' + (index + 1) + '" onclick="selectSceneHistory(' + index + ')" title="点击查看这张">' +
      '<span>#' + (index + 1) + (item.demo ? ' 示例' : '') + '</span>' +
      '<div class="scene-history-actions">' +
        '<button type="button" onclick="saveSceneHistory(' + index + ')">保存</button>' +
        '<button type="button" onclick="deleteSceneHistory(' + index + ')">删除</button>' +
      '</div></div>';
  }).join("");
}

function toggleSceneHistorySelect(index, checked) {
  if (sceneHistory[index]) { sceneHistory[index].selected = !!checked; }
}

function toggleSelectAllSceneHistory() {
  var all = sceneHistory.every(function (x) { return x.selected; });
  sceneHistory.forEach(function (x) { x.selected = !all; });
  renderSceneHistory();
}

function deleteSceneHistory(index) {
  if (!sceneHistory[index]) { return; }
  var removedCurrent = sceneHistory[index].src === currentImageSrc;
  sceneHistory.splice(index, 1);
  if (removedCurrent) {
    if (sceneHistory.length) { selectSceneHistory(sceneHistory.length - 1); }
    else {
      currentImageSrc = "";
      document.getElementById("scene-result").classList.add("hidden");
      document.getElementById("scene-placeholder").classList.remove("hidden");
    }
  }
  renderSceneHistory();
}

function saveSceneHistory(index) {
  if (!sceneHistory[index]) { return; }
  selectSceneHistory(index);
  downloadSceneImage();
}

function saveSelectedSceneImages() {
  var indexes = sceneHistory.map(function (x, i) { return x.selected ? i : -1; }).filter(function (i) { return i >= 0; });
  if (!indexes.length) { showToast("请先勾选要保存的图片"); return; }
  showToast("正在保存 " + indexes.length + " 张图片，请留意浏览器下载提示");
  indexes.forEach(function (i, k) {
    setTimeout(function () { downloadSceneHistoryAt(i); }, k * 500);
  });
}

function downloadSceneHistoryAt(index) {
  var item = sceneHistory[index];
  if (!item) { return; }
  var suffix = item.demo ? "示例图" : "AI生成";
  var kindEl = document.getElementById("scene-kind");
  var kind = kindEl ? kindEl.value : "scene";
  var kindLabel = SCENE_KIND_LABELS[kind] || "商品图";
  var extMatch = /\.(jpg|jpeg|png)/i.exec((item.src || "").split("?")[0]);
  var ext = extMatch ? "." + extMatch[1].toLowerCase() : ".png";
  var filename = kindLabel + "_" + (SCENE_LABELS[selectedScene] || "") + "_" + suffix + "_" + (index + 1) + ext;
  if (item.local) { triggerDownload(item.src, filename); return; }
  fetch(item.src).then(function (resp) { return resp.blob(); }).then(function (blob) {
    triggerDownload(URL.createObjectURL(blob), filename);
  }).catch(function () { window.open(item.src, "_blank"); });
}

function deleteSelectedSceneImages() {
  var keep = sceneHistory.filter(function (x) { return !x.selected; });
  if (keep.length === sceneHistory.length) { showToast("请先勾选要删除的图片"); return; }
  var currentStillThere = keep.some(function (x) { return x.src === currentImageSrc; });
  sceneHistory = keep;
  if (!currentStillThere) {
    if (sceneHistory.length) { selectSceneHistory(sceneHistory.length - 1); }
    else {
      currentImageSrc = "";
      document.getElementById("scene-result").classList.add("hidden");
      document.getElementById("scene-placeholder").classList.remove("hidden");
    }
  }
  renderSceneHistory();
  showToast("已删除选中图片");
}

function selectSceneHistory(index) {
  var item = sceneHistory[index];
  if (!item) { return; }
  currentImageSrc = item.src;
  currentImageLocal = item.local;
  currentImageIsDemo = item.demo;
  document.getElementById("scene-badge").textContent = item.demo ? "演示合成图 · 需人工审核" : "AI 生成 · 需人工审核";
  setSceneDemoNote(!!item.demo);
  document.getElementById("scene-img").src = currentImageSrc;
  var placeholder = document.getElementById("scene-placeholder");
  if (placeholder) { placeholder.classList.add("hidden"); }
  document.getElementById("scene-result").classList.remove("hidden");
  renderSceneHistory();
}

function regenerateSceneWithChat() {
  var chat = document.getElementById("scene-chat");
  var desc = document.getElementById("scene-desc");
  if (!chat || !desc) { return; }
  var text = chat.value.trim();
  if (!text) { showToast("先写一句补充描述"); return; }
  var prefix = sceneHistory.length ? "基于上一张生成结果继续优化：" : "";
  desc.value = (desc.value.trim() ? desc.value.trim() + "\n" : "") + prefix + text;
  chat.value = "";
  generateSceneImage();
}

function showSceneImage() {
  document.getElementById("scene-img").src = currentImageSrc;
  var placeholder = document.getElementById("scene-placeholder");
  var loadingEl = document.getElementById("scene-loading");
  if (placeholder) { placeholder.classList.add("hidden"); }
  if (loadingEl) { loadingEl.classList.add("hidden"); }
  document.getElementById("scene-result").classList.remove("hidden");
}

function showSceneError(msg) {
  if (typeof setAgentState === "function") { setAgentState("image", "error"); }
  document.getElementById("scene-error-msg").textContent = "生成失败：" + msg;
  document.getElementById("scene-error").classList.remove("hidden");
  currentImageSrc = "/static/demo_images/" + selectedScene + ".png";
  currentImageLocal = true;
  currentImageIsDemo = true;
  document.getElementById("scene-badge").textContent = "演示合成图 · 需人工审核";
  setSceneDemoNote(true);
  showSceneImage();
}

function hideSceneError() {
  var el = document.getElementById("scene-error");
  if (el) { el.classList.add("hidden"); }
}

function downloadSceneImage() {
  if (!currentImageSrc) { return; }
  var suffix = currentImageIsDemo ? "示例图" : "AI生成";
  var kindEl = document.getElementById("scene-kind");
  var kind = kindEl ? kindEl.value : "scene";
  var kindLabel = SCENE_KIND_LABELS[kind] || "商品图";
  var filename = kindLabel + "_" + (SCENE_LABELS[selectedScene] || "") + "_" + suffix + sceneFileExt();
  if (currentImageLocal) { triggerDownload(currentImageSrc, filename); return; }
  fetch(currentImageSrc).then(function (resp) { return resp.blob(); }).then(function (blob) {
    triggerDownload(URL.createObjectURL(blob), filename);
  }).catch(function () {
    showToast("图片跨域无法直接下载，已在新窗口打开");
    window.open(currentImageSrc, "_blank");
  });
}

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

function setupSceneKindOther() {
  var el = document.getElementById("scene-kind");
  var input = document.getElementById("scene-kind-other");
  if (!el || !input) { return; }
  if (el.dataset.otherReady !== "1") {
    el.dataset.otherReady = "1";
    el.addEventListener("change", function () { input.classList.toggle("hidden", el.value !== "other"); });
  }
  input.classList.toggle("hidden", el.value !== "other");
}


function showSceneLimitModal(current, add) {
  var modal = document.getElementById("scene-limit-modal");
  var desc = document.getElementById("scene-limit-desc");
  if (desc) {
    desc.textContent = "当前已保存 " + current + " 张，本次要生成 " + add + " 张，合计 " + (current + add) + " 张，超过最多保留的 " + SCENE_HISTORY_LIMIT + " 张。请先删除一些历史图片再生成。";
  }
  if (modal) { modal.classList.remove("hidden"); }
}

function closeSceneLimitModal() {
  var modal = document.getElementById("scene-limit-modal");
  if (modal) { modal.classList.add("hidden"); }
}

function goDeleteSceneHistory() {
  closeSceneLimitModal();
  var box = document.getElementById("scene-history");
  if (box) { box.scrollIntoView({ behavior: "smooth", block: "center" }); }
  showToast("请勾选并删除部分历史图片，腾出位置后再生成");
}


function setSceneDemoNote(show) {
  var el = document.getElementById("scene-demo-note");
  if (!el) { return; }
  el.classList.toggle("hidden", !show);
}
