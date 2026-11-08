/* 出海罗盘 · 交互脚本（状态机与轮询 + 小海螺追问；渲染函数在 render.js） */

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

// ---------- 小海螺追问状态：当前任务 + 各 Tab 独立对话历史 ----------
var currentTaskId = "";
var chatHistories = {};   // tab -> [{role: "user"|"assistant", text: "..."}]
var chatPending = false;

// ---------- Tab 切换：按钮与面板一一对应 ----------
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(function (panel) {
    panel.classList.toggle("active", panel.id === "panel-" + name);
  });
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  // 切 Tab 时从 window.lastResult 重新渲染目标面板；追问气泡从本地历史重绘
  var r = window.lastResult;
  if (!r) { return; }
  if (name === "insight" && r.insight) { renderMarkdown("insight-content", r.insight); markInsightTerms(); }
  else if (name === "listing" && r.listing) { renderMarkdown("listing-content", r.listing); }
  else if (name === "compliance" && r.compliance) { renderCompliance(r.compliance); }
  else if (name === "quality" && r.quality) { renderMarkdown("quality-content", r.quality); }
  renderChatList(name, chatHistories[name] || []);
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

// ---------- 合规审核联动：勾选 + 红项全部表态 → 可标记 → 标记后导出启用；取消勾选或改行状态即复位 ----------
function onReviewCheck() {
  if (!document.getElementById("review-check").checked) { resetReview(); }
  updateReviewGate();
}
function markReviewed() {
  var btn = document.getElementById("btn-mark");
  btn.disabled = true;
  btn.textContent = "✅ 已审核";
  document.getElementById("btn-export-compliance").disabled = false;
  document.getElementById("btn-export-word-compliance").disabled = false;
}
function resetReview() {
  var btn = document.getElementById("btn-mark");
  btn.disabled = true;
  btn.textContent = "标记为已审核";
  document.getElementById("btn-export-compliance").disabled = true;
  document.getElementById("btn-export-word-compliance").disabled = true;
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
    currentTaskId = res.data.task_id;
    chatHistories = {};   // 新任务 → 追问历史清零
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
    if (res.task.status === "done" || res.task.status === "failed") {
      stopPolling();
      window.lastResult = res.task.result;
      renderAllResults(res.task.result);
      resetReviewGate();
      setButtonLoading(false);
      hideSlowTip();
      updateResumeBar();   // 生成结束刷新首页「继续上次结果」横条（成功显示/失败隐藏）
      if (res.task.status === "failed") { showErrorBar(res.task.error || "生成失败"); }
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

// ---------- 单项审核：写入行处理状态（纯内存，不发请求）；已审核后改动 → 重置未审核、导出变灰（勾选态保留） ----------
function setRowStatus(index, value) {
  var rows = window.lastResult && window.lastResult.compliance;
  if (!rows || !rows[index]) { return; }
  rows[index].action_status = value;
  resetReview();
  updateReviewGate();
}

// ---------- 待表态红项数：action_status 缺省或「待处理」都算未表态 ----------
function countPendingRed() {
  var rows = window.lastResult && window.lastResult.compliance;
  if (!rows) { return 0; }
  var n = 0;
  rows.forEach(function (r) {
    if (r.risk_level === "红" && (r.action_status || "待处理") === "待处理") { n++; }
  });
  return n;
}

// ---------- 闸口重算：红字提示待表态数（N>0 即显示，不联动勾选）；按钮可点 = 已勾选 且 红项全部表态 ----------
function updateReviewGate() {
  var n = countPendingRed();
  var tip = document.getElementById("red-pending-tip");
  tip.textContent = "还有 " + n + " 条红项未表态";
  tip.classList.toggle("hidden", n === 0);
  var checked = document.getElementById("review-check").checked;
  document.getElementById("btn-mark").disabled = !checked || n > 0;
}

// ---------- 审核闸口：新结果渲染完成那一刻重置一次，不在轮询帧里反复重置 ----------
function resetReviewGate() {
  document.getElementById("review-check").checked = false;
  resetReview();
  updateReviewGate();   // 新结果无 action_status → 红字显示 N 起引导作用（无红项则不显示）
}

// ---------- 导出 Word：交给后端生成 .docx 并下载（整页跳转即可，无需 Blob） ----------
function exportWord() {
  if (!currentTaskId) { showToast("请先生成报告，再导出 Word"); return; }
  window.location.href = "/api/export-docx/" + window.currentTaskId;
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

// ---------- 小海螺追问：发送 POST /api/chat，历史按 Tab 隔离 ----------
function sendChat(tab, btn) {
  var box = document.getElementById("chat-" + tab);
  var input = box.querySelector(".chat-input");
  var question = input.value.trim();
  if (!question) { showToast("请先输入问题"); return; }
  if (!currentTaskId) { showToast("请先生成报告，再对小海螺提问"); return; }
  if (chatPending) { return; }
  chatPending = true;
  btn.disabled = true;
  input.value = "";
  appendChatBubble(tab, "user", question);
  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: currentTaskId, tab: tab, question: question }),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok) { appendChatError(tab, res.data.error || "请稍后重试"); return; }
    var answer = res.data.answer;
    appendChatBubble(tab, "assistant", answer);
    (chatHistories[tab] = chatHistories[tab] || []).push({ role: "user", text: question });
    chatHistories[tab].push({ role: "assistant", text: answer });
  }).catch(function () {
    appendChatError(tab, "网络异常，请稍后重试");
  }).finally(function () {
    chatPending = false;
    btn.disabled = false;
  });
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
  // 上传识图逻辑在 image.js，独立初始化
  // 合规「处理状态」select：容器级事件委托挂载一次（innerHTML 重渲染不丢；data-index 定位行，位置无关）
  document.getElementById("compliance-content").addEventListener("change", function (e) {
    if (e.target.classList.contains("status-select")) {
      setRowStatus(Number(e.target.dataset.index), e.target.value);
    }
  });
  // 追问输入框：Enter 发送（四个 Tab 统一绑定）
  document.querySelectorAll(".chat-box").forEach(function (box) {
    var tab = box.id.replace("chat-", "");
    var input = box.querySelector(".chat-input");
    var btn = box.querySelector("button");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); sendChat(tab, btn); }
    });
  });
  switchTab("insight");
});