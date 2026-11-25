/* 出海罗盘 · 交互脚本（状态机与轮询 + 小海螺追问；渲染函数在 render.js） */

// ---------- 流水线四段定义：主区进度条与侧边栏状态共用这一份 ----------
var STAGES = [
  { key: "insight",    name: "市场洞察" },
  { key: "listing",    name: "上架文案（中文）" },
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
  if (typeof updateTranslationLanguages === "function") { updateTranslationLanguages(); }
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


// ---------- toast：顶部居中，默认 2 秒消失（失败提示可传更长时长） ----------
var toastTimer = null;
function showToast(msg, duration) {
  var toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.add("hide"); }, duration || 2000);
}

// ---------- 收集表单字段：平台与站点分开，语言取 data-lang 原文 ----------
function collectInfo() {
  var langs = [];
  document.querySelectorAll("#lang-group .lang-btn.active").forEach(function (b) {
    langs.push(b.dataset.lang || b.textContent.trim());
  });
  var marketEl = document.getElementById("market");
  return {
    product: document.getElementById("product").value.trim(),
    selling_points: document.getElementById("selling-points").value.trim(),
    params: document.getElementById("params").value.trim(),
    category: (typeof readCatalogValue === "function" ? readCatalogValue("category") : document.getElementById("category").value),
    platform: (typeof readCatalogValue === "function" ? readCatalogValue("platform") : document.getElementById("platform").value),
    market: marketEl ? (typeof readCatalogValue === "function" ? readCatalogValue("market") : marketEl.value.trim()) : "",
    languages: langs,
  };
}

// ---------- 点「开始生成」：POST /api/generate，拿到 task_id 开始轮询 ----------
function doGenerate() {
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
    resetRevisionState(); // 新任务 → 版本信息清零，直出完成后重新记为第 1 版
    startPolling(res.data.task_id);
  }).catch(function () {
    setButtonLoading(false);
    showErrorBar("网络异常，无法连接服务，请重试");
  });
}


// ---------- 生成前缺项检查：必填用居中提示，非必填给“继续生成/补充表单” ----------
var MISSING_LABELS = { product: "产品名称", category: "产品种类", platform: "目标平台", market: "目标站点/市场" };

function missingFields(info) {
  var keys = [];
  if (!info.product) { keys.push("product"); }
  if (!info.category) { keys.push("category"); }
  if (!info.platform) { keys.push("platform"); }
  if (!info.market) { keys.push("market"); }
  return keys;
}

function generateAll() {
  var info = collectInfo();
  if (!info.product) { showRequiredModal(); return; }
  var missing = missingFields(info);
  if (missing.length) { showMissingNotice(missing); return; }
  doGenerate();
}

function showMissingNotice(keys) {
  var box = document.getElementById("missing-notice");
  var list = document.getElementById("missing-list");
  if (!box || !list) { doGenerate(); return; }
  list.textContent = keys.map(function (k) { return MISSING_LABELS[k] || k; }).join("、");
  box.classList.remove("hidden");
  window.__missingKeys = keys;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function generateAnyway() {
  var box = document.getElementById("missing-notice");
  if (box) { box.classList.add("hidden"); }
  doGenerate();
}

function fillMissingFields() {
  var keys = window.__missingKeys || [];
  var box = document.getElementById("missing-notice");
  if (box) { box.classList.add("hidden"); }
  if (!keys.length) { return; }
  keys.forEach(function (k) { flashField(k); });
  var first = document.getElementById(keys[0]);
  if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); }
}

function flashField(id) {
  var el = document.getElementById(id);
  if (!el) { return; }
  el.classList.remove("flash-field");
  void el.offsetWidth;
  el.classList.add("flash-field");
  setTimeout(function () { el.classList.remove("flash-field"); }, 1500);
}

function showRequiredModal(title, desc, targetId) {
  var modal = document.getElementById("required-modal");
  var t = document.getElementById("required-title");
  var d = document.getElementById("required-desc");
  if (t) { t.textContent = title || "⚠️ 还差一步"; }
  if (d) { d.textContent = desc || "请先填写产品名称，这是生成报告的必要信息。"; }
  window.__requiredTarget = targetId || "product";
  if (modal) { modal.classList.remove("hidden"); }
}

function focusRequiredField() {
  var modal = document.getElementById("required-modal");
  if (modal) { modal.classList.add("hidden"); }
  var id = window.__requiredTarget || "product";
  var el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flashField(id);
    setTimeout(function () { if (el.focus) { el.focus(); } }, 350);
  }
}

function focusMissingProduct() { window.__requiredTarget = "product"; focusRequiredField(); }

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
      renderDemoNote(res.task.result);
      renderToolTrace(res.task.result);
      resetReviewGate();
      setButtonLoading(false);
      hideSlowTip();
      updateResumeBar();   // 生成结束刷新首页「继续上次结果」横条（成功显示/失败隐藏）
      if (typeof renderCardStates === "function") { renderCardStates(res.task.result); }
      if (res.task.status === "done" && typeof goFirstSection === "function") { goFirstSection(); }
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
    if (bar) {
      bar.className = "stage stage-" + state;
      bar.innerHTML = icon + s.name;
    }
    var side = document.getElementById("agent-" + (i + 1));
    if (side) {
      side.className = "py-1 " + (state === "todo" ? "text-slate-400" :
        state === "active" ? "text-brand" :
        state === "error" ? "text-[#B91C1C]" : "text-[#15803D]");
      side.innerHTML = sideIcon + s.name;
    }

    // 总览四段卡状态：待生成 / 生成中 / 已完成 / 失败
    var card = document.getElementById("card-state-" + s.key);
    if (card) {
      card.textContent = state === "done" ? "已完成" : state === "active" ? "生成中"
        : state === "error" ? "失败" : "待生成";
      card.classList.toggle("is-done", state === "done");
      card.classList.toggle("is-running", state === "active");
    }
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

// ---------- 导出：勾选段落 + 每段自选版本（不默认），Word / Markdown 一致 ----------
var EXPORT_TITLES = { insight: "市场洞察", listing: "上架文案", compliance: "合规体检", quality: "交叉质检", translate: "多语翻译" };

function exportWord(section) { openExportModal(section, "word"); }
function exportTab(section) { openExportModal(section, "md"); }

function openExportModal(section, format) {
  var r = window.lastResult || {};
  var hasAny = !!(r.insight || r.listing || r.quality || (r.compliance && r.compliance.length) || r.compliance_raw || window.lastTranslateResult);
  if (!currentTaskId && !hasAny) { showToast("当前还没有报告，请先生成后再导出", 4000); return; }
  var modal = document.getElementById("export-modal");
  if (!modal) { return; }
  document.querySelectorAll("#export-options input[type=checkbox]").forEach(function (box) {
    box.checked = box.value === (section || "insight");
  });
  document.querySelectorAll("#export-format input[type=radio]").forEach(function (radio) {
    radio.checked = radio.value === (format || "word");
  });
  resetVersionPickers();
  fillExportVersions();
  var hint = document.getElementById("export-version-hint");
  if (hint) { hint.textContent = "请为已勾选的段落选择版本；不选版本不能导出。"; hint.classList.remove("warn"); }
  modal.classList.remove("hidden");
}

var EXPORT_SECTIONS = ["insight", "listing", "compliance", "quality", "translate"];

function fillExportVersions() {
  Promise.all(EXPORT_SECTIONS.map(function (tab) {
    if (tab === "translate") {
      // 多语翻译是独立功能：没有任务版本历史，始终导出当前翻译结果
      revisionState.translate = {
        history: [],
        current: window.lastTranslateResult || "",
        currentTime: window.lastTranslateTime || null,
        currentVersion: 1,
        limit: REVISION_LIMIT,
        viewing: "latest",
      };
      return Promise.resolve();
    }
    if (!currentTaskId) { return Promise.resolve(); }
    return fetch("/api/revisions/" + currentTaskId + "/" + tab).then(function (res) { return res.json(); }).then(function (data) {
      if (data.ok) {
        var prev = revisionState[tab] || {};
        revisionState[tab] = {
          history: data.history || [],
          current: data.current || "",
          currentTime: data.current_time || prev.currentTime || null,
          currentVersion: data.current_version || 1,
          limit: data.limit || REVISION_LIMIT,
          viewing: prev.viewing || "latest",
        };
      }
    }).catch(function () {});
  })).then(renderExportVersionLists);
}

function fmtRevisionTime(ts) {
  if (!ts) { return ""; }
  var d = new Date(ts * 1000);
  function p(n) { return n < 10 ? "0" + n : n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function revisionPickLabel(pick) {
  var st = revisionState[pick.section];
  if (pick.version === "latest") {
    return "第 " + ((st && st.currentVersion) || 1) + " 版";
  }
  return "第 " + pick.version + " 版";
}

function revisionKeyword(instruction) {
  var text = (instruction || "").replace(/\s+/g, "").trim();
  if (!text) { return "直出"; }
  return text.length > 8 ? text.slice(0, 8) : text;
}

function revisionCardsHtml(tab, name) {
  var state = revisionState[tab] || { history: [] };
  var currentVersion = state.currentVersion || 1;
  var items = (state.history || []).slice().sort(function (a, b) { return (a.version || 0) - (b.version || 0); });
  var hasCurrent = items.some(function (item) { return Number(item.version) === Number(currentVersion); });
  var html = "";
  if (!hasCurrent) {
    html += '<label class="rev-card" title="' + escapeHtml(state.currentTime ? fmtRevisionTime(state.currentTime) : "当前内容") + '">' +
      '<input type="radio" name="' + name + '" value="latest" onchange="onVersionPicked(\'' + tab + '\')">' +
      '<span class="rev-card-main"><strong>第 ' + currentVersion + ' 版</strong>' +
      '<small>最新版本</small></span></label>';
  }
  items.forEach(function (item) {
    var isCurrent = Number(item.version) === Number(currentVersion);
    var timeText = item.time ? fmtRevisionTime(item.time) : "";
    html += '<label class="rev-card"' + (timeText ? ' title="' + escapeHtml(timeText) + '"' : '') + '>' +
      '<input type="radio" name="' + name + '" value="' + item.version + '" onchange="onVersionPicked(\'' + tab + '\')">' +
      '<span class="rev-card-main"><strong>第 ' + item.version + ' 版' + (isCurrent ? " · 最新" : "") + '</strong>' +
      '<small>' + (isCurrent ? "最新版本 · " : "") + escapeHtml(revisionKeyword(item.instruction)) + '</small></span></label>';
  });
  return html;
}

function renderExportVersionLists() {
  EXPORT_SECTIONS.forEach(function (tab) {
    var box = document.getElementById("export-versions-" + tab);
    if (!box) { return; }
    box.innerHTML = revisionCardsHtml(tab, "export-ver-" + tab);
    var section = document.querySelector('#export-options .export-section[data-section="' + tab + '"]');
    var checkbox = section ? section.querySelector("input[type=checkbox]") : null;
    var picker = section ? section.querySelector(".export-version-picker") : null;
    if (picker) { picker.classList.toggle("hidden", !(checkbox && checkbox.checked)); }
  });
}

function resetVersionPickers() {
  EXPORT_SECTIONS.forEach(function (tab) {
    var list = document.getElementById("export-versions-" + tab);
    if (list) {
      list.classList.add("hidden");
      list.querySelectorAll("input[type=radio]").forEach(function (radio) { radio.checked = false; });
    }
    var section = document.querySelector('#export-options .export-section[data-section="' + tab + '"]');
    var checkbox = section ? section.querySelector("input[type=checkbox]") : null;
    var picker = section ? section.querySelector(".export-version-picker") : null;
    if (picker) { picker.classList.toggle("hidden", !(checkbox && checkbox.checked)); }
    var btn = document.querySelector('.export-version-toggle[data-section="' + tab + '"]');
    if (btn) {
      btn.textContent = "选择版本 ▾";
      btn.classList.remove("is-picked");
    }
  });
}

function toggleVersionPicker(tab) {
  var list = document.getElementById("export-versions-" + tab);
  if (!list) { return; }
  var willOpen = list.classList.contains("hidden");
  EXPORT_SECTIONS.forEach(function (other) {
    if (other !== tab) {
      var otherList = document.getElementById("export-versions-" + other);
      if (otherList) { otherList.classList.add("hidden"); }
    }
  });
  list.classList.toggle("hidden", !willOpen);
}

function onVersionPicked(tab) {
  var list = document.getElementById("export-versions-" + tab);
  if (!list) { return; }
  var radio = list.querySelector("input[type=radio]:checked");
  var btn = document.querySelector('.export-version-toggle[data-section="' + tab + '"]');
  if (!radio || !btn) { return; }
  var label = radio.closest("label");
  var strong = label ? label.querySelector("strong") : null;
  var text = strong ? strong.textContent.split("·")[0].trim() : ("第 " + radio.value + " 版");
  btn.textContent = text + " ▾";
  btn.classList.add("is-picked");
  list.classList.add("hidden");
}

function syncExportRow(box) {
  var section = box.closest(".export-section");
  var picker = section ? section.querySelector(".export-version-picker") : null;
  if (picker) { picker.classList.toggle("hidden", !box.checked); }
  if (!box.checked && section) {
    section.querySelectorAll("input[type=radio]").forEach(function (r) { r.checked = false; });
    var list = section.querySelector(".export-version-list");
    if (list) { list.classList.add("hidden"); }
    var btn = section.querySelector(".export-version-toggle");
    if (btn) {
      btn.textContent = "选择版本 ▾";
      btn.classList.remove("is-picked");
    }
  }
}

function closeExportModal() {
  var modal = document.getElementById("export-modal");
  if (modal) { modal.classList.add("hidden"); }
}

function toggleAllExport(checked) {
  document.querySelectorAll("#export-options input[type=checkbox]").forEach(function (box) {
    box.checked = !!checked;
    syncExportRow(box);
  });
}

function confirmExport() {
  var picks = [];
  var missing = [];
  document.querySelectorAll("#export-options .export-section").forEach(function (section) {
    var tab = section.getAttribute("data-section");
    var box = section.querySelector("input[type=checkbox]");
    if (!box || !box.checked) { return; }
    var radio = section.querySelector("input[type=radio]:checked");
    if (!radio) { missing.push(EXPORT_TITLES[tab] || tab); return; }
    picks.push({ section: tab, version: radio.value });
  });
  if (missing.length) { showToast("请为这些段落选择版本：" + missing.join("、"), 4500); return; }
  if (!picks.length) { showToast("请至少勾选一段再导出"); return; }
  var formatEl = document.querySelector("#export-format input[type=radio]:checked");
  var format = formatEl ? formatEl.value : "word";
  closeExportModal();
  if (format === "md") { exportMarkdown(picks); return; }
  exportBinary(picks, format);
}

function currentSectionContent(tab) {
  var r = window.lastResult || {};
  if (tab === "compliance") {
    return (r.compliance && r.compliance.length) ? rowsToMarkdown(r.compliance) : (r.compliance_raw || "");
  }
  return r[tab] || "";
}

function contentForPick(pick, forBinary) {
  if (pick.section === "translate") { return window.lastTranslateResult || ""; }
  var state = revisionState[pick.section] || {};
  var isCurrent = pick.version === "latest" || String(pick.version) === String(state.currentVersion || 1);
  if (pick.section === "compliance" && isCurrent) {
    var r = window.lastResult || {};
    if (forBinary && r.compliance && r.compliance.length) { return r.compliance; }
    return currentSectionContent("compliance");
  }
  if (isCurrent) { return currentSectionContent(pick.section); }
  var item = (state.history || []).filter(function (x) { return String(x.version) === String(pick.version); })[0];
  if (item) { return item.content || ""; }
  return "";
}

function exportBinary(picks, format) {
  var onlyTranslate = picks.every(function (pick) { return pick.section === "translate"; });
  if (!currentTaskId && !onlyTranslate) { showToast("当前报告已失效，请重新生成后再导出", 4000); return; }
  var sections = [];
  var contents = {};
  picks.forEach(function (pick) {
    var body = contentForPick(pick, true);
    if (body) { sections.push(pick.section); contents[pick.section] = body; }
  });
  if (!sections.length) { showToast("当前没有可导出的内容"); return; }
  var path = format === "pdf" ? "/api/export-pdf/" : "/api/export-docx/";
  fetch(path + (currentTaskId || "translate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections: sections, contents: contents }),
  }).then(function (res) {
    if (!res.ok) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        throw new Error(data.error || "导出失败（HTTP " + res.status + "）");
      });
    }
    return res.blob().then(function (blob) {
      saveBlob(blob, fileNameFromHeader(res.headers.get("Content-Disposition")));
    });
  }).catch(function (err) {
    showToast(err.message || "导出失败，请稍后重试", 4000);
  });
}

function exportMarkdown(picks) {
  var parts = [];
  picks.forEach(function (pick) {
    var body = contentForPick(pick);
    if (!body) { return; }
    var ver = revisionPickLabel(pick);
    parts.push("# " + (EXPORT_TITLES[pick.section] || pick.section) + "（" + ver + "）\n\n" + body);
  });
  if (!parts.length) { showToast("当前没有可导出的内容，请先生成"); return; }
  var content = parts.join("\n\n---\n\n");
  var hasTranslate = picks.some(function (pick) { return pick.section === "translate"; });
  var filename;
  if (picks.length === 4 && !hasTranslate) { filename = "出海四项报告.md"; }
  else if (picks.length === 1) { filename = (EXPORT_TITLES[picks[0].section] || "导出") + ".md"; }
  else { filename = "出海报告.md"; }
  var blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

// ---------- Listing 一键复制：复制去 Markdown 标记的纯文本文案 ----------
function listingPlainText() {
  var md = (window.lastResult || {}).listing || "";
  if (!md) { return ""; }
  var text = (typeof stripMarkdownFence === "function") ? stripMarkdownFence(md) : md;
  return text.split("\n").map(function (line) {
    return line.replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*[-*]\s+/, "· ")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function copyListingText() {
  var text = listingPlainText();
  if (!text) { showToast("还没有生成 Listing 文案"); return; }
  copyText(text, "Listing 文案已复制，可直接粘贴");
}

function copyText(text, okMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      showToast(okMsg || "已复制");
    }).catch(function () { fallbackCopyText(text, okMsg); });
    return;
  }
  fallbackCopyText(text, okMsg);
}

function fallbackCopyText(text, okMsg) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  showToast(ok ? (okMsg || "已复制") : "复制失败，请手动选择文本");
}

// ---------- 小海螺追问：发送 POST /api/chat，历史按 Tab 隔离 ----------
function sendChat(tab, btn) {
  var box = document.getElementById("chat-" + tab);
  var input = box.querySelector(".chat-input");
  var question = input.value.trim();
  if (!question) { showToast("请先输入问题"); return; }
  if (!currentTaskId) { showToast("请先生成报告，再对罗盘提问"); return; }
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


// ---------- 演示数据说明 ----------
function renderDemoNote(result) {
  var el = document.getElementById("demo-result-note");
  if (!el) { return; }
  if (result && result.demo_notice) {
    el.textContent = result.demo_notice;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// ---------- 工具调用痕迹：写在“证据与来源”第一行 ----------
function renderToolTrace(result) {
  var t = (result && result.tool_trace) || {};
  var wc = t.word_check || {};
  var line;
  if (result && result.demo) {
    line = "🔧 本次调用：演示数据组装 · 违禁词库 v" + (wc.version || "—") + "（" + (wc.checked || 0) + " 条，命中 " + ((wc.hits || []).length) + "）" +
      " · 识图模型 未使用 · 生图 未使用 · Word 导出 未生成";
  } else {
    line = "🔧 本次调用：违禁词库 v" + (wc.version || "—") + "（" + (wc.checked || 0) + " 条，命中 " + ((wc.hits || []).length) + "）" +
      " · 识图模型 " + (t.vision ? "已使用" : "未使用") +
      " · 生图 " + (t.image ? "已使用" : "未使用") +
      " · Word 导出 " + (t.export ? "已生成" : "未生成");
  }
  ["insight", "listing", "compliance", "quality"].forEach(function (tab) {
    var el = document.getElementById("tool-trace-" + tab);
    if (el) { el.textContent = line; }
  });
}

// ---------- 协商改写：只改当前段；insight/listing 只重跑第 4 段质检 ----------
function reviseSection(tab, btn) {
  if (!currentTaskId) { showToast("请先生成报告，再协商改写"); return; }
  if (tab === "compliance") { showToast("合规表是结构化结果，不支持整段改写；可修改上架文案后重新生成", 4000); return; }
  var box = document.getElementById("chat-" + tab);
  var input = box.querySelector(".chat-input");
  var instruction = input.value.trim();
  if (!instruction) { showToast("请先写一句要怎么改"); return; }
  var revState = revisionState[tab];
  if (revState && revState.history && revState.history.length >= (revState.limit || REVISION_LIMIT)) {
    showToast("这一段已达到 " + (revState.limit || REVISION_LIMIT) + " 个版本（含首次直出存档），请先删除历史存档再改写", 5000);
    openRevisionManager(tab);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "改写中…"; }
  setAgentState(SECTION_AGENT[tab], "active");
  fetch("/api/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: currentTaskId, section: tab, instruction: instruction }),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok || !res.data.ok) {
      setAgentState(SECTION_AGENT[tab], "error");
      appendChatError(tab, res.data.error || "改写失败，请稍后重试");
      return;
    }
    var data = res.data;
    var r = window.lastResult || (window.lastResult = {});
    r[data.section] = data.content;
    if (data.section === "insight") { renderMarkdown("insight-content", data.content); }
    if (data.section === "listing") { renderMarkdown("listing-content", data.content); }
    if (data.quality) {
      r.quality = data.quality;
      renderMarkdown("quality-content", data.quality);
    }
    input.value = "";
    updateRevisionBadge(tab, data.revision);
    setAgentState(SECTION_AGENT[tab], "done");
    if (data.section === "insight" || data.section === "listing") {
      setAgentState(4, "done");
      if (data.quality_revision) { updateRevisionBadge("quality", data.quality_revision); }
      loadRevisionInfo("quality");
    }
    viewRevision(tab, "latest");
    loadRevisionInfo(tab);
    scrollResultIntoView(tab);
    appendChatBubble(tab, "assistant", "已改写并重新质检（当前第 " + data.revision + " 版）");
    showToast("已改写本页，当前第 " + data.revision + " 版；可在导出按钮右侧切换历史版本");
  }).catch(function () {
    setAgentState(SECTION_AGENT[tab], "error");
    appendChatError(tab, "网络异常，改写失败");
  }).finally(function () {
    if (btn) { btn.disabled = false; btn.textContent = "✏️ 改写本页"; }
  });
}


function recheckQuality(btn) {
  if (!currentTaskId) { showToast("请先生成报告，再重算质检"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "重算中…"; }
  setAgentState(4, "active");
  fetch("/api/recheck-quality", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: currentTaskId }),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok || !res.data.ok) {
      setAgentState(4, "error");
      appendChatError("quality", res.data.error || "重算质检失败");
      return;
    }
    var r = window.lastResult || (window.lastResult = {});
    r.quality = res.data.quality;
    renderMarkdown("quality-content", res.data.quality);
    setAgentState(4, "done");
    viewRevision("quality", "latest");
    updateRevisionBadge("quality", res.data.revision);
    loadRevisionInfo("quality");
    appendChatBubble("quality", "assistant", "已按当前前三段重新计算质检（当前第 " + res.data.revision + " 版）。");
    showToast(res.data.history_full
      ? "已重算第 4 段质检，当前第 " + res.data.revision + " 版；历史已满，新版本未存档"
      : "已重算第 4 段质检，当前第 " + res.data.revision + " 版");
  }).catch(function () {
    setAgentState(4, "error");
    appendChatError("quality", "网络异常，重算失败");
  }).finally(function () {
    if (btn) { btn.disabled = false; btn.textContent = "🔁 重算质检"; }
  });
}

function updateRevisionBadge(tab, version) {
  var el = document.getElementById("revision-" + tab);
  if (el) { el.textContent = version ? "第 " + version + " 版" : ""; }
}

function resetRevisionState() {
  revisionState = {};
  revisionManagerSection = "";
  ["insight", "listing", "compliance", "quality"].forEach(function (tab) {
    updateRevisionBadge(tab, 0);
    var el = document.getElementById("rev-count-" + tab);
    if (el) { el.textContent = "暂无历史版本"; }
  });
}

// ---------- 左侧状态：翻译 / 生图 / 单段重算实时联动 ----------
var AGENT_NAMES = { 1: "市场洞察", 2: "上架文案（中文）", 3: "合规体检", 4: "交叉质检", translate: "多语翻译", image: "智能生图" };
var SECTION_AGENT = { insight: 1, listing: 2, compliance: 3, quality: 4 };

function setAgentState(key, state) {
  var el = document.getElementById("agent-" + key);
  if (!el) { return; }
  var icon = state === "done" ? "✅ " :
    state === "active" ? '<span class="spin">⟳</span> ' :
    state === "error" ? "❌ " : "⏳ ";
  el.className = "py-1 " + (state === "todo" ? "text-slate-400" :
    state === "active" ? "text-brand" :
    state === "error" ? "text-[#B91C1C]" : "text-[#15803D]");
  el.innerHTML = icon + (AGENT_NAMES[key] || "");
}

// ---------- 改写历史版本：查看 / 管理（最多 20 个旧版，可单选或批量删除） ----------
var revisionState = {};
var revisionManagerSection = "";
var REVISION_LIMIT = 20;
var REVISION_TITLES = { insight: "市场洞察", listing: "上架文案", compliance: "合规体检", quality: "交叉质检" };

function sectionTitleOf(tab) { return REVISION_TITLES[tab] || tab; }

function loadRevisionInfo(tab) {
  if (!currentTaskId) { return; }
  fetch("/api/revisions/" + currentTaskId + "/" + tab).then(function (res) { return res.json(); }).then(function (data) {
    if (!data.ok) { return; }
    var prev = revisionState[tab] || {};
    revisionState[tab] = {
      history: data.history || [],
      current: data.current || "",
      currentTime: data.current_time || prev.currentTime || null,
      currentVersion: data.current_version || 1,
      limit: data.limit || REVISION_LIMIT,
      viewing: prev.viewing || "latest",
    };
    updateRevisionBadge(tab, revisionState[tab].currentVersion);
    renderRevisionTools(tab);
  }).catch(function () {});
}

function renderRevisionTools(tab) {
  var state = revisionState[tab];
  if (!state) { return; }
  var countEl = document.getElementById("rev-count-" + tab);
  if (countEl) {
    var version = state.currentVersion || 1;
    var kept = state.history.length;
    countEl.textContent = "当前第 " + version + " 版" + (kept ? " · 历史 " + kept + "/" + (state.limit || REVISION_LIMIT) : "");
  }
}

function setRevisionViewNote(tab, text) {
  var content = document.getElementById(tab + "-content");
  if (!content) { return; }
  var note = document.getElementById("rev-note-" + tab);
  if (!note) {
    note = document.createElement("p");
    note.id = "rev-note-" + tab;
    note.className = "revision-view-note";
    content.parentNode.insertBefore(note, content.nextSibling);
  }
  note.textContent = text || "";
  note.classList.toggle("hidden", !text);
}

function viewRevision(tab, value) {
  var state = revisionState[tab];
  if (!state) { return; }
  if (value === "latest") {
    state.viewing = "latest";
    if (tab === "compliance") {
      renderCompliance((window.lastResult || {}).compliance || []);
    } else {
      renderMarkdown(tab + "-content", (window.lastResult || {})[tab] || state.current);
    }
    setRevisionViewNote(tab, "");
    return;
  }
  var item = (state.history || []).filter(function (x) { return String(x.version) === String(value); })[0];
  if (!item) { return; }
  if (String(item.version) === String(state.currentVersion || 1)) {
    viewRevision(tab, "latest");
    return;
  }
  state.viewing = item.version;
  renderMarkdown(tab + "-content", item.content);
  var timeText = item.time ? "（" + fmtRevisionTime(item.time) + "）" : "";
  setRevisionViewNote(tab, "正在查看第 " + item.version + " 版" + timeText + "（只读）。导出将导出这一版；需要最新版本请点「查看最新版本」。");
}

function viewRevisionFromManager(version) {
  viewRevision(revisionManagerSection, version);
  closeRevisionModal();
}

function viewLatestRevision() {
  viewRevision(revisionManagerSection, "latest");
  closeRevisionModal();
}

function openRevisionManager(tab) {
  if (!currentTaskId) { showToast("请先生成报告"); return; }
  revisionManagerSection = tab;
  fetch("/api/revisions/" + currentTaskId + "/" + tab).then(function (res) { return res.json(); }).then(function (data) {
    if (!data.ok) { showToast(data.error || "读取历史失败"); return; }
    revisionState[tab] = {
      history: data.history || [],
      current: data.current || "",
      currentTime: data.current_time || (revisionState[tab] || {}).currentTime || null,
      currentVersion: data.current_version || 1,
      limit: data.limit || REVISION_LIMIT,
      viewing: (revisionState[tab] || {}).viewing || "latest",
    };
    updateRevisionBadge(tab, revisionState[tab].currentVersion);
    renderRevisionManager();
    document.getElementById("revision-modal").classList.remove("hidden");
  }).catch(function () { showToast("网络异常，读取历史失败"); });
}

function renderRevisionManager() {
  var tab = revisionManagerSection;
  var state = revisionState[tab] || { history: [], limit: REVISION_LIMIT, currentVersion: 1 };
  var currentVersion = state.currentVersion || 1;
  document.getElementById("rev-modal-section").textContent = sectionTitleOf(tab);
  var badge = document.getElementById("rev-modal-count");
  if (badge) { badge.textContent = "第 " + currentVersion + " 版 · 历史 " + state.history.length; }
  document.getElementById("rev-modal-hint").textContent =
    "首次直出会存为第 1 版；之后每次改写或重算都会新增版本并留在历史。最多保留 " +
    (state.limit || REVISION_LIMIT) + " 个版本（含最新版），删除存档不影响当前页内容。";
  var list = document.getElementById("rev-modal-list");
  if (!state.history.length) {
    list.innerHTML = '<p class="export-hint">' + (tab === "compliance"
      ? "历史存档已清空。合规表不支持整段改写，当前页内容仍可查看与导出。"
      : "历史存档已清空。当前页内容仍可查看与导出；下次改写会重新存档。") + '</p>';
    return;
  }
  var items = state.history.slice().sort(function (a, b) { return (a.version || 0) - (b.version || 0); });
  list.innerHTML = items.map(function (item) {
    var isCurrent = Number(item.version) === Number(currentVersion);
    var timeText = item.time ? " · " + fmtRevisionTime(item.time) : "";
    return '<div class="rev-item"><input type="checkbox" value="' + item.version + '">' +
      '<span class="rev-item-main"><strong>第 ' + item.version + ' 版' + (isCurrent ? "（最新）" : "") + timeText + '</strong>' +
      '<em>' + escapeHtml(revisionKeyword(item.instruction)) + '</em></span>' +
      '<button type="button" class="rev-view" onclick="viewRevisionFromManager(' + item.version + ')">查看</button></div>';
  }).join("");
}

function toggleAllRevisions() {
  var boxes = document.querySelectorAll("#rev-modal-list input[type=checkbox]");
  var all = Array.prototype.every.call(boxes, function (x) { return x.checked; });
  Array.prototype.forEach.call(boxes, function (x) { x.checked = !all; });
}

function deleteSelectedRevisions() {
  var tab = revisionManagerSection;
  var versions = Array.prototype.map.call(
    document.querySelectorAll("#rev-modal-list input[type=checkbox]:checked"),
    function (x) { return parseInt(x.value, 10); }
  );
  if (!versions.length) { showToast("请先勾选要删除的历史版本"); return; }
  fetch("/api/revisions/" + currentTaskId + "/" + tab + "/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versions: versions }),
  }).then(function (res) { return res.json(); }).then(function (data) {
    if (!data.ok) { showToast(data.error || "删除失败", 4000); return; }
    var prev = revisionState[tab] || {};
    revisionState[tab] = {
      history: data.history || [],
      current: prev.current || "",
      currentTime: prev.currentTime || null,
      currentVersion: prev.currentVersion || 1,
      limit: prev.limit || REVISION_LIMIT,
      viewing: prev.viewing || "latest",
    };
    if (versions.indexOf(prev.viewing) >= 0) {
      revisionState[tab].viewing = "latest";
      viewRevision(tab, "latest");
    }
    renderRevisionManager();
    renderRevisionTools(tab);
    showToast("已删除 " + data.removed + " 个历史版本");
  }).catch(function () { showToast("网络异常，删除失败"); });
}

function closeRevisionModal() {
  var modal = document.getElementById("revision-modal");
  if (modal) { modal.classList.add("hidden"); }
}

function scrollResultIntoView(tab) {
  var box = document.getElementById(tab + "-content");
  if (!box) { return; }
  box.scrollTop = 0;
  if (box.scrollIntoView) {
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---------- 生成按钮加载态：禁用 + 图标转圈 ----------
function setButtonLoading(loading) {
  var btn = document.getElementById("btn-generate");
  if (btn) { btn.disabled = loading; }
  var icon = document.getElementById("btn-icon");
  if (icon) {
    icon.textContent = loading ? "⟳" : "🚀";
    icon.classList.toggle("spin", loading);
  }
  var label = document.getElementById("btn-label");
  if (label) { label.textContent = loading ? "生成中…" : "开始生成四项报告"; }
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
});