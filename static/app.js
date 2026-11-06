/* 出海罗盘 · 交互脚本（3B：四段全通——轮询状态机 + 渲染 + 导出） */

// ---------- 流水线四段定义：主区进度条与侧边栏状态共用这一份 ----------
var STAGES = [
  { key: "insight",    name: "市场洞察" },
  { key: "listing",    name: "多语种文案" },
  { key: "compliance", name: "合规体检" },
  { key: "quality",    name: "交叉质检" },
];
var POLL_INTERVAL = 1500;     // 轮询间隔 1.5 秒
var POLL_TIMEOUT = 300000;    // 轮询上限 5 分钟（实测四段 30–60 秒，留 5–10 倍余量）
var SLOW_WARN = 60000;        // 连续 60 秒 progress 无变化 → 显示"生成较慢"
var pollTimer = null;
var pollStartTime = 0;
var lastProgressValue = -1;
var lastProgressTime = 0;

// ---------- Tab 切换：按钮与面板一一对应 ----------
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(function (panel) {
    panel.classList.toggle("active", panel.id === "panel-" + name);
  });
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  // 切 Tab 时从 window.lastResult 重新渲染目标面板，不依赖 DOM 是否还留着
  var r = window.lastResult;
  if (!r) { return; }
  if (name === "insight" && r.insight) { renderMarkdown("insight-content", r.insight); }
  else if (name === "listing" && r.listing) { renderMarkdown("listing-content", r.listing); }
  else if (name === "compliance" && r.compliance) { renderCompliance(r.compliance); }
  else if (name === "quality" && r.quality) { renderMarkdown("quality-content", r.quality); }
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

// ---------- 图片上传区（纯 UI 预览，识图后续阶段接入） ----------
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
  hideSlowTip();
  lastProgressValue = -1;
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
  lastProgressTime = pollStartTime;
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
    trackProgress(res.task.progress);
    updateStages(res.task);
    if (res.task.status === "done") {
      stopPolling();
      window.lastResult = res.task.result;
      renderAllResults(res.task.result);
      resetReviewGate();
      setButtonLoading(false);
      hideSlowTip();
    } else if (res.task.status === "failed") {
      stopPolling();
      window.lastResult = res.task.result;
      renderAllResults(res.task.result);
      resetReviewGate();
      setButtonLoading(false);
      hideSlowTip();
      showErrorBar(res.task.error || "生成失败");
    }
  }).catch(function () {
    // 单次网络异常：不中断轮询、不白屏，靠 5 分钟超时兜底
  });
}

// ---------- 进度跟踪：连续 60 秒无变化显示"生成较慢"，不中止轮询 ----------
function trackProgress(progress) {
  var now = Date.now();
  if (progress !== lastProgressValue) {
    lastProgressValue = progress;
    lastProgressTime = now;
    hideSlowTip();
  } else if (now - lastProgressTime > SLOW_WARN) {
    showSlowTip();
  }
}
function showSlowTip() {
  document.getElementById("slow-tip").classList.remove("hidden");
}
function hideSlowTip() {
  document.getElementById("slow-tip").classList.add("hidden");
}

// ---------- 状态联动：主区进度条 + 侧边栏，共用同一份 task 数据 ----------
function updateStages(task) {
  for (var i = 0; i < STAGES.length; i++) {
    var s = STAGES[i];
    var state = "todo";
    if (task.result && task.result[s.key]) { state = "done"; }
    else if (task.status === "running" && task.stage === s.key) { state = "active"; }
    else if (task.status === "failed" && task.stage === s.key) { state = "error"; }
    var icon = state === "done" ? "✅ " :
      state === "active" ? '<span class="spin">⟳</span> ' :
      state === "error" ? "❌ " : "○ ";
    var sideIcon = state === "done" ? "✅ " :
      state === "active" ? '<span class="spin">⟳</span> ' :
      state === "error" ? "❌ " : "⏳ ";
    var bar = document.getElementById("stage-" + (i + 1));
    bar.className = "stage stage-" + state;
    bar.innerHTML = icon + s.name;
    var side = document.getElementById("agent-" + (i + 1));
    side.className = "py-1 " + (state === "todo" ? "text-slate-400" :
      state === "active" ? "text-brand" :
      state === "error" ? "text-[#B91C1C]" : "text-[#15803D]");
    side.innerHTML = sideIcon + s.name;
  }
}

// ---------- 渲染：Markdown 公共渲染（只转义 < 和 &，> 是 Markdown 引用块语法） ----------
function renderMarkdown(elId, text) {
  var safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  document.getElementById(elId).innerHTML = marked.parse(safe);
}

// ---------- 渲染：合规表格动态生成（单元格全量转义，模型输出不执行） ----------
function renderCompliance(rows) {
  var box = document.getElementById("compliance-content");
  if (!rows || rows.length === 0) {
    box.innerHTML = '<p class="text-slate-400">合规体检未能解析出结构化结果，请展开下方"证据与来源"查看模型原文。</p>';
    return;
  }
  var head = '<div class="overflow-x-auto rounded-2xl border border-line bg-white card-shadow">' +
    '<table class="compliance w-full text-sm border-collapse">' +
    '<colgroup><col style="width:25%"><col style="width:10%"><col style="width:30%"><col style="width:25%"><col style="width:10%"></colgroup>' +
    '<thead><tr><th>风险项</th><th>风险等级</th><th>依据</th><th>整改建议</th><th>需人工核实</th></tr></thead><tbody>';
  var body = "";
  rows.forEach(function (r) {
    var cls = r.risk_level === "红" ? "tag-red" : r.risk_level === "黄" ? "tag-yellow" : "tag-green";
    body += "<tr><td>" + escapeHtml(r.item) + '</td><td><span class="tag ' + cls + '">' +
      escapeHtml(r.risk_level) + "</span></td><td>" + escapeHtml(r.basis) + "</td><td>" +
      escapeHtml(r.action) + "</td><td>" + escapeHtml(r.need_verify) + "</td></tr>";
  });
  box.innerHTML = head + body + "</tbody></table></div>";
}

// ---------- 渲染：四 Tab 全量渲染 + 证据折叠区填原文 ----------
function renderAllResults(result) {
  if (result.insight) { renderMarkdown("insight-content", result.insight); }
  if (result.listing) { renderMarkdown("listing-content", result.listing); }
  if (result.compliance) { renderCompliance(result.compliance); }
  if (result.quality) { renderMarkdown("quality-content", result.quality); }
  fillEvidence("evidence-insight", result.insight);
  fillEvidence("evidence-listing", result.listing);
  fillEvidence("evidence-compliance", result.compliance_raw);
  fillEvidence("evidence-quality", result.quality);
}
function fillEvidence(id, text) {
  document.getElementById(id).textContent = text || "（本段未返回内容）";
}

// ---------- 审核闸口：新结果渲染完成那一刻重置一次，不在轮询帧里反复重置 ----------
function resetReviewGate() {
  document.getElementById("review-check").checked = false;
  resetReview();
}

// ---------- 导出：当前 Tab 内容下载为 .md（Blob + a.download） ----------
function exportTab(name) {
  var r = window.lastResult || {};
  var content = "";
  var filename = "导出.md";
  if (name === "insight") { content = r.insight || ""; filename = "市场洞察.md"; }
  else if (name === "listing") { content = r.listing || ""; filename = "多语种Listing.md"; }
  else if (name === "compliance") {
    content = (r.compliance && r.compliance.length) ? rowsToMarkdown(r.compliance) : (r.compliance_raw || "");
    filename = "合规体检.md";
  }
  else if (name === "quality") { content = r.quality || ""; filename = "质检报告.md"; }
  if (!content) { showToast("当前没有可导出的内容，请先生成"); return; }
  var blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- 合规行转 Markdown 表格（导出用） ----------
function rowsToMarkdown(rows) {
  var md = "| 风险项 | 风险等级 | 依据 | 整改建议 | 需人工核实 |\n|---|---|---|---|---|\n";
  rows.forEach(function (r) {
    md += "| " + r.item + " | " + r.risk_level + " | " + r.basis + " | " + r.action + " | " + r.need_verify + " |\n";
  });
  return md;
}

// ---------- HTML 全量转义（合规表格单元格用） ----------
function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", function () {
  setupUpload();
  switchTab("insight");
});