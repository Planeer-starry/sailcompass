/* 出海罗盘 · 识图模块（上传产品图 → POST /api/analyze-image → 覆盖回填左侧表单） */

var IMAGE_CATEGORIES = ["3C电子", "家具家居", "服装鞋帽", "皮具箱包", "户外用品", "美妆个护", "母婴玩具", "汽车配件", "五金工具", "食品饮料", "其他"];
var IMAGE_MAX_SIZE = 20 * 1024 * 1024;         // 与后端一致：20MB 上限
var IMAGE_TYPES = ["image/jpeg", "image/png"]; // 只收 JPG / PNG
var FIELD_IDS = { product: "product", category: "category", selling_points: "selling-points", params: "params" };
var PARAM_KEYS = ["容量", "材质", "尺寸"];     // params 子键不确定 → 标到参数输入框

var imageAnalyzing = false;  // 识别中：忽略再次选图 + 禁用「开始生成」
var previewUrl = "";         // 当前缩略图 URL（换图时回收，防泄漏）

// ---------- 上传区：点击选择 / 拖拽，识别期间一律忽略 ----------
function setupUpload() {
  var zone = document.getElementById("upload-zone");
  var input = document.getElementById("image-input");
  zone.addEventListener("click", function () {
    if (imageAnalyzing) { showToast("正在识别产品图，请稍候"); return; }
    input.click();
  });
  input.addEventListener("change", function () {
    if (input.files[0]) { handleImageFile(input.files[0]); }
  });
  zone.addEventListener("dragover", function (e) {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", function () { zone.classList.remove("dragover"); });
  zone.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (imageAnalyzing) { showToast("正在识别产品图，请稍候"); return; }
    var file = e.dataTransfer.files[0];
    if (file && IMAGE_TYPES.indexOf(file.type) !== -1) { handleImageFile(file); }
    else { showToast("请选择 JPG / PNG 图片"); }
  });
  setupUncertainListeners();
}

// 用户手动改动字段 → 摘掉该字段的"AI 推测"黄标（程序赋值不触发 input，只有真人操作触发）
function setupUncertainListeners() {
  Object.keys(FIELD_IDS).forEach(function (key) {
    var id = FIELD_IDS[key];
    var el = document.getElementById(id);
    el.addEventListener("input", function () { unmarkUncertain(id); });
    el.addEventListener("change", function () { unmarkUncertain(id); });
  });
}

// ---------- 选中文件：前端预校验 → 缩略图 + 文件名 → 自动识别 ----------
function handleImageFile(file) {
  if (file.size > IMAGE_MAX_SIZE) { showToast("图片超过 20MB，请压缩后重试"); return; }
  hideUploadFallback();
  clearUncertainMarks();
  if (previewUrl) { URL.revokeObjectURL(previewUrl); }
  previewUrl = URL.createObjectURL(file);
  document.getElementById("image-preview").src = previewUrl;
  document.getElementById("image-name").textContent = file.name;
  document.getElementById("upload-empty").classList.add("hidden");
  document.getElementById("upload-filled").classList.remove("hidden");
  analyzeImage(file);
}

// 重新选择：识别中忽略；复位为空态并清黄标
function resetUpload() {
  if (imageAnalyzing) { return; }
  document.getElementById("image-input").value = "";
  document.getElementById("upload-empty").classList.remove("hidden");
  document.getElementById("upload-filled").classList.add("hidden");
  setUploadStatus("");
  hideUploadFallback();
  clearUncertainMarks();
}

// ---------- 调 /api/analyze-image：同一张图重复上传就正常重新识别 ----------
function analyzeImage(file) {
  setAnalyzing(true);
  var form = new FormData();
  form.append("file", file, file.name);
  fetch("/api/analyze-image", { method: "POST", body: form }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    setAnalyzing(false);
    if (res.data.error) { handleAnalyzeError(res.data.error); return; }
    fillForm(res.data);
    setUploadStatus("");
    showToast("已根据图片覆盖表单内容，请核对后生成");
  }).catch(function () {
    setAnalyzing(false);
    handleAnalyzeError("网络异常，无法连接识图服务");
  });
}

// 失败统一处理：具体原因 toast + 状态行；上传区灰字兜底，不阻塞手动填写
function handleAnalyzeError(msg) {
  var display = (msg.indexOf("未识别到产品") !== -1)
    ? "没识别出产品，请换一张图或手动填写"
    : "识图失败：" + msg;
  showToast(display);
  setUploadStatus(display, true);
  showUploadFallback();
}

// ---------- 覆盖式回填：识别结果直接覆盖对应字段（不做"只填空"逻辑） ----------
function fillForm(result) {
  clearUncertainMarks();
  document.getElementById("product").value = result.product || "";
  var category = result.category || "";
  if (IMAGE_CATEGORIES.indexOf(category) !== -1) {
    document.getElementById("category").value = category;
  }
  document.getElementById("selling-points").value = (result.selling_points || []).join("、");
  document.getElementById("params").value = formatParams(result.params || {});
  (result.uncertain || []).forEach(markUncertain);
}

// params 对象 → 「容量：xx，材质：xx」一行（空值跳过，三个子键之外的不丢弃）
function formatParams(params) {
  var parts = [];
  Object.keys(params).forEach(function (key) {
    if (params[key]) { parts.push(key + "：" + params[key]); }
  });
  return parts.join("，");
}

// uncertain 字段名 → 输入框黄标；params 子键（容量/材质/尺寸）标到参数框；对不上的忽略不猜
function markUncertain(field) {
  var id = FIELD_IDS[field];
  if (!id && PARAM_KEYS.indexOf(field) !== -1) { id = "params"; }
  if (!id) { return; }
  var el = document.getElementById(id);
  if (el.classList.contains("ai-uncertain")) { return; }
  el.classList.add("ai-uncertain");
  var tip = document.createElement("p");
  tip.className = "ai-uncertain-tip";
  tip.textContent = "AI 从图片推测，请确认后修改";
  el.insertAdjacentElement("afterend", tip);
}

function unmarkUncertain(id) {
  var el = document.getElementById(id);
  if (!el.classList.contains("ai-uncertain")) { return; }
  el.classList.remove("ai-uncertain");
  var tip = el.parentElement.querySelector(".ai-uncertain-tip");
  if (tip) { tip.remove(); }
}

function clearUncertainMarks() {
  Object.keys(FIELD_IDS).forEach(function (key) { unmarkUncertain(FIELD_IDS[key]); });
}

// ---------- 识别状态：期间禁用「开始生成」防拿半截表单跑四段；结束时若四段生成进行中（pollTimer 活着）则不恢复 ----------
function setAnalyzing(analyzing) {
  imageAnalyzing = analyzing;
  setUploadStatus(analyzing ? "🔍 正在识别产品图…" : "");
  var btn = document.getElementById("btn-generate");
  if (analyzing) { btn.disabled = true; }
  else if (!pollTimer) { btn.disabled = false; }
}

// 上传区状态行：识别中主色、出错橙红
function setUploadStatus(msg, isError) {
  var el = document.getElementById("upload-status");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
  el.classList.toggle("status-error", !!isError);
}

function showUploadFallback() {
  document.getElementById("upload-fallback").classList.remove("hidden");
}
function hideUploadFallback() {
  document.getElementById("upload-fallback").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", function () { setupUpload(); });