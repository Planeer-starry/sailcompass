/* 出海罗盘 · 渲染层（从 app.js 拆出：结果渲染 / 表格 / 气泡 / 导出内容生成） */

// ---------- Markdown 公共渲染（只转义 < 和 &，> 是 Markdown 引用块语法） ----------
function renderMarkdown(elId, text) {
  var safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  document.getElementById(elId).innerHTML = marked.parse(safe);
}

// ---------- 合规表格动态生成（单元格全量转义，模型输出不执行；第 6 列「处理状态」单项审核） ----------
function renderCompliance(rows) {
  var box = document.getElementById("compliance-content");
  if (!rows || rows.length === 0) {
    box.innerHTML = '<p class="text-slate-400">合规体检未能解析出结构化结果，请展开下方"证据与来源"查看模型原文。</p>';
    return;
  }
  var head = '<div class="overflow-x-auto rounded-2xl border border-line bg-white card-shadow">' +
    '<table class="compliance w-full text-sm border-collapse">' +
    '<colgroup><col style="width:20%"><col style="width:8%"><col style="width:26%"><col style="width:22%"><col style="width:8%"><col style="width:16%"></colgroup>' +
    '<thead><tr><th>风险项</th><th>风险等级' + termTag("风险等级（红黄绿）", true, "term-down") + '</th><th>依据</th><th>整改建议</th><th>需人工核实' + termTag("需人工核实", true, "term-down") + "</th>" +
    '<th title="已整改=我改了文案或补了材料；不适用=这条不适用我的情况；已确认=知道风险但决定不改">处理状态</th></tr></thead><tbody>';
  var body = "";
  rows.forEach(function (r, i) {
    var cls = r.risk_level === "红" ? "tag-red" : r.risk_level === "黄" ? "tag-yellow" : "tag-green";
    body += "<tr><td>" + escapeHtml(r.item) + '</td><td><span class="tag ' + cls + '">' +
      escapeHtml(r.risk_level) + "</span></td><td>" + escapeHtml(r.basis) + "</td><td>" +
      escapeHtml(r.action) + "</td><td>" + escapeHtml(r.need_verify) + "</td><td>" +
      statusSelectHtml(i, r.action_status || "待处理") + "</td></tr>";
  });
  box.innerHTML = head + body + "</tbody></table></div>" +
    '<p class="compliance-note">红项需全部表态后才能审核通过；黄项和绿项不强制。</p>';
}

// ---------- 处理状态 select：data-index 定位行，由容器级事件委托读取（app.js 挂载一次），位置无关 ----------
function statusSelectHtml(index, current) {
  var opts = "";
  ["待处理", "已整改", "不适用", "已确认"].forEach(function (s) {
    opts += '<option value="' + s + '"' + (s === current ? " selected" : "") + ">" + s + "</option>";
  });
  return '<select class="status-select" data-index="' + index + '">' + opts + "</select>";
}

// ---------- 四 Tab 全量渲染 + 证据折叠区填原文 ----------
function renderAllResults(result) {
  if (result.insight) { renderMarkdown("insight-content", result.insight); markInsightTerms(); }
  if (result.listing) { renderMarkdown("listing-content", result.listing); }
  if (result.compliance) { renderCompliance(result.compliance); }
  if (result.quality) { renderMarkdown("quality-content", result.quality); }
  fillEvidence("evidence-insight", result.insight);
  fillEvidence("evidence-listing", result.listing);
  fillEvidence("evidence-compliance", result.compliance_raw);
  fillEvidence("evidence-quality", result.quality);
  triggerFreshEntrance();
}

// ---------- 新结果入场动画：给四个面板加 .result-fresh（anim.css 依次落下），600ms 后摘除 ----------
function triggerFreshEntrance() {
  var panels = document.querySelectorAll(".tab-panel");
  panels.forEach(function (p) { p.classList.add("result-fresh"); });
  setTimeout(function () {
    panels.forEach(function (p) { p.classList.remove("result-fresh"); });
  }, 600);
}

function fillEvidence(id, text) {
  var el = document.getElementById(id);
  el.textContent = text || "（本段未返回内容）";
  var box = el.closest("details");
  if (!box) { return; }
  var old = box.querySelector(".demo-evidence-note");
  if (old) { old.remove(); }
  if (window.demoMode) {
    var note = document.createElement("p");
    note.className = "demo-evidence-note";
    note.textContent = "本条结果来自内置示例数据";
    box.insertBefore(note, el);
  }
}

// ---------- 追问气泡：历史重绘与单条追加（textContent 赋值，天然不执行 HTML） ----------
function renderChatList(tab, history) {
  var list = document.querySelector("#chat-" + tab + " .chat-list");
  list.innerHTML = "";
  history.forEach(function (msg) {
    appendChatBubble(tab, msg.role, msg.text, false);
  });
  list.scrollTop = list.scrollHeight;
}

function appendChatBubble(tab, role, text, scroll) {
  var list = document.querySelector("#chat-" + tab + " .chat-list");
  var bubble = document.createElement("div");
  bubble.className = "chat-bubble " + (role === "user" ? "chat-user" : "chat-assistant");
  bubble.textContent = text;
  list.appendChild(bubble);
  if (scroll !== false) { list.scrollTop = list.scrollHeight; }
}

function appendChatError(tab, msg) {
  var list = document.querySelector("#chat-" + tab + " .chat-list");
  var bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-assistant error";
  bubble.textContent = "回答失败：" + msg;
  list.appendChild(bubble);
  list.scrollTop = list.scrollHeight;
}

// ---------- 导出内容生成：合规 rows 转 Markdown 表格（含处理状态列 + 红黄统计行） ----------
function rowsToMarkdown(rows) {
  var md = "| 风险项 | 风险等级 | 依据 | 整改建议 | 需人工核实 | 处理状态 |\n|---|---|---|---|---|---|\n";
  var redTotal = 0, redDone = 0, yellowTotal = 0, yellowDone = 0;
  rows.forEach(function (r) {
    var status = r.action_status || "待处理";
    var done = status !== "待处理";
    if (r.risk_level === "红") { redTotal++; if (done) { redDone++; } }
    else if (r.risk_level === "黄") { yellowTotal++; if (done) { yellowDone++; } }
    md += "| " + r.item + " | " + r.risk_level + " | " + r.basis + " | " + r.action + " | " + r.need_verify + " | " + status + " |\n";
  });
  md += "\n红项 " + redTotal + " 条，已处理 " + redDone + " 条；黄项 " + yellowTotal + " 条，已处理 " + yellowDone + " 条。\n";
  return md;
}

// ---------- HTML 全量转义（合规表格单元格用） ----------
function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}