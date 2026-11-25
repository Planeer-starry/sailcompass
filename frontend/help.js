/* 出海罗盘 v1 · 跨境指引（三段式引导条 + 跨境指引页 + 术语标记）
   - 面向中年老板和小白：先看三步，遇到「站点 / 平台 / Listing」这类词查表
   - 分段页底部还有「这一段里的名词」卡片，内容由 index.html 直接给
*/

var GUIDE_KEY = "guide_dismissed";

// ---------- 术语 → 解释映射（termTag 与洞察标记共用；glossary.js 先于本文件加载） ----------
var TIP_MAP = {};
GLOSSARY.forEach(function (g) { TIP_MAP[g.term] = g.tip; });

// ---------- 生成术语 span：q=true 为小圆标问号，否则术语文本带虚线下划线 ----------
function termTag(term, q, extraCls) {
  var tip = escapeHtml(TIP_MAP[term] || "");
  return '<span class="term' + (q ? " term-q" : "") + (extraCls ? " " + extraCls : "") +
    '" data-tip="' + tip + '">' + (q ? "?" : escapeHtml(term)) + "</span>";
}

// ---------- 洞察术语标记：只碰文本节点，把 Listing 包上 .term ----------
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

// ---------- 首次引导条：插在总览页标题下方，关闭后写 localStorage ----------
function initGuideBar() {
  var dismissed = false;
  try { dismissed = !!localStorage.getItem(GUIDE_KEY); }
  catch (e) { console.warn("localStorage 不可用，引导条将每次显示：" + e.message); }
  if (dismissed) { return; }
  var anchor = document.querySelector("#panel-overview .page-head");
  if (anchor) { anchor.insertAdjacentHTML("afterend", guideBarHtml()); }
}

function dismissGuide() {
  var bar = document.getElementById("guide-bar");
  if (bar) { bar.remove(); }
  try { localStorage.setItem(GUIDE_KEY, "1"); }
  catch (e) { console.warn("localStorage 不可用，引导条仅本次关闭：" + e.message); }
}

function guideBarHtml() {
  return '<div id="guide-bar" class="guide-bar">' +
    '<p class="guide-title">👋 第一次用？四步搞定</p>' +
    '<div class="guide-steps">' +
    "<p>① 在「出海四项报告」填产品资料：平台和站点分开选</p>" +
    "<p>② 点「开始生成四项报告」，等约 30 秒</p>" +
    "<p>③ 左侧点某一段，整页只看这一段</p>" +
    "<p>④ 不懂跨境名词？<a href=\"#/help\">查看跨境指引 →</a></p>" +
    "</div>" +
    '<button type="button" class="guide-close" onclick="dismissGuide()">知道了</button>' +
    "</div>";
}

// ---------- 跨境指引页 ----------
var helpRendered = false;

function renderHelp() {
  if (helpRendered) { return; }
  helpRendered = true;
  document.getElementById("view-help").innerHTML =
    '<div class="help-wrap">' + helpHeadHtml() + helpStepsHtml() + glossaryHtml() + faqHtml() + helpFooterHtml() + "</div>";
}

function helpHeadHtml() {
  return '<header class="help-head"><h1>🧭 跨境指引</h1>' +
    "<p>不懂跨境也能用明白：先看三步，遇到「站点」「平台」「Listing」这些词查下面的表。</p></header>";
}

function helpStepsHtml() {
  return '<section class="help-card"><h2>三步上手</h2><div class="help-steps">' +
    '<div><span class="help-step-num">1</span><p class="help-step-title">填一次产品资料</p>' +
    "<p class=\"help-step-desc\">产品名、卖点、产品种类；目标平台和站点分开选，目标语言带中文对照</p></div>" +
    '<div><span class="help-step-num">2</span><p class="help-step-title">生成四项报告</p>' +
    "<p class=\"help-step-desc\">等约 30 秒，市场洞察、Listing、合规、质检依次跑完</p></div>" +
    '<div><span class="help-step-num">3</span><p class="help-step-title">左侧分段查看</p>' +
    "<p class=\"help-step-desc\">点哪一段就整页只看哪一段；每段下面都有这一段的名词解释</p></div>" +
    "</div></section>";
}

function glossaryHtml() {
  var rows = GLOSSARY.map(function (g) {
    return "<tr><td>" + escapeHtml(g.term) + "</td><td>" + escapeHtml(g.tip) + "</td></tr>";
  }).join("");
  return '<section class="help-card" id="glossary"><h2>名词解释</h2>' +
    '<table class="glossary"><thead><tr><th>名词</th><th>大白话解释</th></tr></thead><tbody>' +
    rows + "</tbody></table></section>";
}

function faqHtml() {
  var faqs = [
    ["平台和站点有什么区别？", "平台是渠道，例如 Amazon、TikTok Shop、Shopee；站点是市场，例如美国、德国、日本。先选在哪卖，再选卖给哪个国家或地区。"],
    ["站点属性为什么是市场？", "因为同一个平台有很多国家站。美国站和德国站的人群、法规、语言都不同，所以站点要按国别或地区单独选。"],
    ["为什么目标语言要带中文？", "老板群体主要看中文判断内容对不对。每段外语文案都会附中文对照，不用先看懂外语才能核对。"],
    ["生成要多久？", "约 30 秒，四个角色（洞察 → 文案 → 合规 → 质检）依次跑完。"],
    ["结果能直接上架吗？", "不能。AI 只给建议，规格、认证、法规和平台政策必须人工复核后才能用。"],
    ["红项必须全改吗？", "不一定。可以逐条选「已整改」「不适用」或「已确认」，但红项必须全部表态后才能导出。"],
    ["支持哪些语言？", "16 种常见跨境语言，最多选 3 种。Listing 会按所选语言生成，并逐段附中文对照。"],
  ];
  return '<section class="help-card"><h2>常见问题</h2>' + faqs.map(function (f) {
    return '<details class="help-faq"><summary>' + escapeHtml(f[0]) + "</summary><p>" + escapeHtml(f[1]) + "</p></details>";
  }).join("") + "</section>";
}

function helpFooterHtml() {
  return '<p class="help-footer">还是不懂？去 <a href="#/ask">聆听您的声音</a> 直接问罗盘，或到任意分段页下方追问。</p>';
}

document.addEventListener("DOMContentLoaded", initGuideBar);