/* 出海罗盘 · 渲染层（从 app.js 拆出：结果渲染 / 表格 / 气泡 / 导出内容生成） */

// ---------- Markdown 公共渲染（只转义 < 和 &，> 是 Markdown 引用块语法） ----------
function renderMarkdown(elId, text) {
  var safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  document.getElementById(elId).innerHTML = marked.parse(safe);
}

// ---------- 合规表格动态生成（单元格全量转义，模型输出不执行） ----------
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

// ---------- 四 Tab 全量渲染 + 证据折叠区填原文 ----------
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

// ---------- 导出内容生成：合规 rows 转 Markdown 表格 ----------
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