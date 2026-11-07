/* 出海罗盘 · 帮助系统（首次引导条 + #/help 帮助页 + 洞察术语标记；内容本文件注入，不进 index.html 保行数红线） */

// ---------- 引导条关闭标记：localStorage key ----------
var GUIDE_KEY = "guide_dismissed";

// ---------- 术语 → 解释映射（termTag 与洞察标记共用；glossary.js 先于本文件加载） ----------
var TIP_MAP = {};
GLOSSARY.forEach(function (g) { TIP_MAP[g.term] = g.tip; });

// ---------- 生成术语 span：q=true 为小圆标问号（label/表头后），否则术语文本带虚线下划线；extraCls 附加类（如表头用 term-down 朝下弹） ----------
function termTag(term, q, extraCls) {
  var tip = escapeHtml(TIP_MAP[term] || "");
  return '<span class="term' + (q ? " term-q" : "") + (extraCls ? " " + extraCls : "") +
    '" data-tip="' + tip + '">' + (q ? "?" : escapeHtml(term)) + "</span>";
}

// ---------- 洞察术语标记：TreeWalker 只碰文本节点，把 Listing 字样包上 .term（仅此一处，不做全文替换） ----------
function markInsightTerms() {
  var box = document.getElementById("insight-content");
  if (!box || !TIP_MAP["Listing"]) { return; }
  var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      return n.nodeValue.indexOf("Listing") !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  }, false);
  var nodes = [];
  while (walker.nextNode()) { nodes.push(walker.currentNode); }
  nodes.forEach(function (node) { wrapListing(node); });
}

// ---------- 单个文本节点内的 Listing 替换为 .term span（DocumentFragment 重组，模型输出不执行 HTML） ----------
function wrapListing(node) {
  var text = node.nodeValue;
  var frag = document.createDocumentFragment();
  var idx;
  while ((idx = text.indexOf("Listing")) !== -1) {
    if (idx > 0) { frag.appendChild(document.createTextNode(text.slice(0, idx))); }
    var span = document.createElement("span");
    span.className = "term";
    span.setAttribute("data-tip", TIP_MAP["Listing"]);
    span.textContent = "Listing";
    frag.appendChild(span);
    text = text.slice(idx + "Listing".length);
  }
  if (text) { frag.appendChild(document.createTextNode(text)); }
  node.parentNode.replaceChild(frag, node);
}

// ---------- 首次引导条：未关闭过才注入到工作台 header 之后（不写进 index.html） ----------
function initGuideBar() {
  var dismissed = false;
  try { dismissed = !!localStorage.getItem(GUIDE_KEY); }
  catch (e) { console.warn("localStorage 不可用，引导条将每次显示：" + e.message); }
  if (dismissed) { return; }
  var header = document.querySelector("#main header");
  if (header) { header.insertAdjacentHTML("afterend", guideBarHtml()); }
}

// ---------- 「知道了」：移除横条 + 写 localStorage（隐私模式写入失败则仅本次关闭，不静默吞） ----------
function dismissGuide() {
  var bar = document.getElementById("guide-bar");
  if (bar) { bar.remove(); }
  try { localStorage.setItem(GUIDE_KEY, "1"); }
  catch (e) { console.warn("localStorage 不可用，引导条仅本次关闭：" + e.message); }
}

// ---------- 引导条结构：三步横排（小屏 flex-wrap 换行）+ 知道了按钮 ----------
function guideBarHtml() {
  return '<div id="guide-bar" class="guide-bar">' +
    '<p class="guide-title">👋 第一次用？三步搞定</p>' +
    '<div class="guide-steps">' +
    "<p>① 填产品信息（也可以传张图、或说一句话）</p>" +
    "<p>② 点「开始生成」，等约 30 秒</p>" +
    "<p>③ 看四个 Tab 的结果，有疑问可以直接追问 · <a href=\"#/help\">查看完整帮助 →</a></p>" +
    "</div>" +
    '<button type="button" class="guide-close" onclick="dismissGuide()">知道了</button>' +
    "</div>";
}

// ---------- 帮助页渲染：首次切到 #/help 时 innerHTML 填入（标志位保证只填一次） ----------
var helpRendered = false;

function renderHelp() {
  if (helpRendered) { return; }
  helpRendered = true;
  document.getElementById("view-help").innerHTML =
    '<div class="help-wrap">' + helpHeadHtml() + helpStepsHtml() + glossaryHtml() + faqHtml() + helpFooterHtml() + "</div>";
}

function helpHeadHtml() {
  return '<header class="help-head"><h1>❓ 帮助中心</h1>' +
    "<p>不懂跨境也能上手：先看三步，遇到术语查下表，还有问题直接问</p></header>";
}

// ---------- ① 三步上手：与引导条文案一致，圆形序号 + 说明 ----------
function helpStepsHtml() {
  return '<section class="help-card"><h2>三步上手</h2><div class="help-steps">' +
    '<div><span class="help-step-num">1</span><p class="help-step-title">填产品信息</p>' +
    "<p class=\"help-step-desc\">填产品名、卖点；也可以传张图、或说一句话</p></div>" +
    '<div><span class="help-step-num">2</span><p class="help-step-title">点「开始生成」</p>' +
    "<p class=\"help-step-desc\">等约 30 秒，四个 Agent 依次跑，不用盯</p></div>" +
    '<div><span class="help-step-num">3</span><p class="help-step-title">看四个 Tab 的结果</p>' +
    "<p class=\"help-step-desc\">有疑问可以在每个 Tab 下方直接追问</p></div>" +
    "</div></section>";
}

// ---------- ② 术语表：glossary.js 全表渲染成两列表格 ----------
function glossaryHtml() {
  var rows = GLOSSARY.map(function (g) {
    return "<tr><td>" + escapeHtml(g.term) + "</td><td>" + escapeHtml(g.tip) + "</td></tr>";
  }).join("");
  return '<section class="help-card"><h2>术语表</h2>' +
    '<table class="glossary"><thead><tr><th>术语</th><th>解释</th></tr></thead><tbody>' +
    rows + "</tbody></table></section>";
}

// ---------- ③ 常见问题 5 条：原生 details 折叠 ----------
function faqHtml() {
  var faqs = [
    ["生成要多久？", "约 30 秒，四个 Agent（洞察 → 文案 → 合规 → 质检）依次跑完。"],
    ["结果能直接上架吗？", "不能，AI 只给建议，需人工复核确认后才能导出交付。"],
    ["红项必须全改吗？", "不一定，可以在「处理状态」里选「不适用」或「已确认接受」，但必须逐条表态。"],
    ["数据从哪来？", "模型知识库，没有依据的都标了「需人工核实」，请人工查证后再用。"],
    ["支持哪些语言？", "英 / 西 / 德 / 法，最多选 3 种，Listing 会翻译为所选语言。"],
  ];
  return '<section class="help-card"><h2>常见问题</h2>' + faqs.map(function (f) {
    return '<details class="help-faq"><summary>' + escapeHtml(f[0]) + "</summary><p>" + escapeHtml(f[1]) + "</p></details>";
  }).join("") + "</section>";
}

// ---------- ④ 底部：兜底指向结果页追问 ----------
function helpFooterHtml() {
  return '<p class="help-footer">还是不懂？在结果页任意 Tab 下方直接问小海螺 💬</p>';
}

// ---------- 初始化：注入引导条（帮助页渲染由路由触发） ----------
document.addEventListener("DOMContentLoaded", initGuideBar);