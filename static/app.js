/* 出海罗盘 · 交互脚本（阶段 3A：异步任务 + 轮询，只接市场洞察） */

// ---------- 流水线四段定义：主区进度条与侧边栏状态共用这一份 ----------
var STAGES = [
  { key: "insight",    name: "市场洞察" },
  { key: "listing",    name: "多语种文案" },
  { key: "compliance", name: "合规体检" },
  { key: "quality",    name: "交叉质检" },
];
var POLL_INTERVAL = 1500;    // 轮询间隔 1.5 秒
var POLL_TIMEOUT = 180000;   // 轮询上限 3 分钟
var pollTimer = null;
var pollStartTime = 0;

// ---------- Tab 切换：按钮与面板一一对应 ----------
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(function (panel) {
    panel.classList.toggle("active", panel.id === "panel-" + name);
  });
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  // 切 Tab 时从 window.lastResult 重新渲染，不依赖 DOM 是否还留着
  if (name === "insight" && window.lastResult && window.lastResult.insight) {
    renderInsight(window.lastResult.insight);
  }
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

// ---------- 图片上传区（纯 UI 预览，识图阶段 3 接入） ----------
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

// ---------- 收集表单六字段 ----------
function collectInfo() {
  var langs = [];
  document.querySelectorAll(".lang-btn.active").forEach(function (b) {
    langs.push(b.textContent.trim());
  });
  return {
    product: document.getElementById("product").value.trim(),
    selling_points: document.getElementById("selling-points").value.trim(),
    params: document.getElementById("params").value.trim(),
    category: document.getElementById("category").value,
    platform: document.getElementById("platform").value,
    languages: langs,
  };
}

// ---------- 点「开始生成」：POST /api/generate，拿到 task_id 开始轮询 ----------
function generateAll() {
  var info = collectInfo();
  if (!info.product) { showToast("请先填写产品名称"); return; }
  setButtonLoading(true);
  hideErrorBar();
  fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(info),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok) {
      setButtonLoading(false);
      showErrorBar(res.data.error || "创建任务失败");
      return;
    }
    startPolling(res.data.task_id);
  }).catch(function () {
    setButtonLoading(false);
    showErrorBar("网络异常，无法连接服务，请重试");
  });
}

// ---------- 轮询：done / failed / 超时 三个条件都会停 ----------
function startPolling(taskId) {
  pollStartTime = Date.now();
  stopPolling();
  pollTimer = setInterval(function () { pollOnce(taskId); }, POLL_INTERVAL);
  pollOnce(taskId);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
function pollOnce(taskId) {
  if (Date.now() - pollStartTime > POLL_TIMEOUT) {
    stopPolling();
    setButtonLoading(false);
    showErrorBar("请求超时，请重试");
    return;
  }
  fetch("/api/task/" + taskId).then(function (resp) {
    return resp.json().then(function (task) { return { ok: resp.ok, task: task }; });
  }).then(function (res) {
    if (!res.ok) {
      stopPolling();
      setButtonLoading(false);
      showErrorBar(res.task.error || "任务不存在");
      return;
    }
    updateStages(res.task);
    if (res.task.status === "done") {
      stopPolling();
      window.lastResult = res.task.result;
      renderInsight(res.task.result.insight);
      setButtonLoading(false);
    } else if (res.task.status === "failed") {
      stopPolling();
      setButtonLoading(false);
      showErrorBar(res.task.error || "生成失败");
    }
  }).catch(function () {
    // 单次网络异常：不中断轮询、不白屏，靠 3 分钟超时兜底
  });
}

// ---------- 状态联动：主区进度条 + 侧边栏，共用同一份 task 数据 ----------
function updateStages(task) {
  for (var i = 0; i < STAGES.length; i++) {
    var s = STAGES[i];
    var state = "todo";
    if (task.result && task.result[s.key]) { state = "done"; }
    else if (task.status === "running" && task.stage === s.key) { state = "active"; }
    var icon = state === "done" ? "✅ " :
      state === "active" ? '<span class="spin">⟳</span> ' : "○ ";
    var sideIcon = state === "done" ? "✅ " :
      state === "active" ? '<span class="spin">⟳</span> ' : "⏳ ";
    var bar = document.getElementById("stage-" + (i + 1));
    bar.className = "stage stage-" + state;
    bar.innerHTML = icon + s.name;
    var side = document.getElementById("agent-" + (i + 1));
    side.className = "py-1 " + (state === "todo" ? "text-slate-400" :
      state === "active" ? "text-brand" : "text-[#15803D]");
    side.innerHTML = sideIcon + s.name;
  }
}

// ---------- 渲染市场洞察：只转义 < 和 &（> 是 Markdown 引用块语法，不转义），再 marked.parse ----------
function renderInsight(text) {
  var safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  document.getElementById("insight-content").innerHTML = marked.parse(safe);
}

// ---------- 生成按钮加载态：禁用 + 图标转圈 ----------
function setButtonLoading(loading) {
  document.getElementById("btn-generate").disabled = loading;
  var icon = document.getElementById("btn-icon");
  icon.textContent = loading ? "⟳" : "🚀";
  icon.classList.toggle("spin", loading);
  document.getElementById("btn-label").textContent = loading ? "生成中…" : "开始生成";
}

// ---------- 错误条：持久显示错误 + 重试按钮 ----------
function showErrorBar(msg) {
  document.getElementById("error-msg").textContent = msg;
  document.getElementById("error-bar").classList.remove("hidden");
}
function hideErrorBar() {
  document.getElementById("error-bar").classList.add("hidden");
}

// ---------- 假按钮：演示模式提示（识图/生图/导出后续阶段接入） ----------
function demoAction() {
  showToast("演示模式：该功能将在后续阶段接入");
}

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", function () {
  setupUpload();
  switchTab("insight");
});