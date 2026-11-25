/* 出海罗盘 · 首页小海螺自由问答（独立于四 Tab 追问：无需任务/报告，纯常识问答；历史仅存内存不持久化） */

var askHistory = [];        // [{role:"user"|"assistant", content:"..."}] 最近对话
var askPending = false;     // 提交中：忽略重复提交
var askLastQuestion = "";   // 上次提交的问题：3 秒内同问题不重复提交
var askLastTime = 0;        // 上次提交时刻


// ---------- 提交入口：卡片收起时先展开恢复对话；3 秒防重 → 发请求（回车/按钮共用） ----------
function submitAsk() {
  var input = document.getElementById("ask-input");
  var question = input.value.trim();
  var panel = document.getElementById("ask-panel");
  // 收起后再点按钮/回车：有历史即恢复卡片（空输入只展开不提问）——「收起后打不开」的修复入口
  if (panel.classList.contains("hidden") && askHistory.length > 0) {
    openAskPanel();
    scrollAskIntoView();
  }
  if (!question || askPending) { return; }
  if (question === askLastQuestion && Date.now() - askLastTime < 3000) {
    showToast("同一问题请稍等几秒再问");
    return;
  }
  askLastQuestion = question;
  askLastTime = Date.now();
  sendAsk(question);
}

// ---------- 提交入口：提交瞬间先显示问题气泡 + 思考指示，再交给意图分流 ----------
function sendAsk(question) {
  askPending = true;
  setAskLoading(true);
  appendAskBubble("user", question);
  var thinking = appendThinkingBubble();
  // intent.js 先判「生成 / 咨询」；脚本缺失时直接走原咨询路径
  if (typeof routeAskIntent === "function") { routeAskIntent(question, thinking); }
  else { requestAskAnswer(question, thinking); }
}

// ---------- 原咨询路径：POST /api/ask，回答到达后替换思考指示 ----------
function requestAskAnswer(question, thinking) {
  fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: question, history: askHistory.slice(-6) }),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    thinking.remove();
    setAskLoading(false);
    askPending = false;
    if (res.ok && res.data.answer) {
      appendAskBubble("assistant", res.data.answer);
      pushAskHistory(question, res.data.answer);
      document.getElementById("ask-input").value = "";
      return;
    }
    // 429/模型异常等统一降级文案；参数错误（400）展示后端原文（如「问题太长了」）
    var msg = res.data.error || "罗盘现在有点忙，稍后再试";
    appendAskBubble("error", msg + '　<button class="ask-retry" onclick="retryAsk()">重试</button>');
  }).catch(function () {
    thinking.remove();
    setAskLoading(false);
    askPending = false;
    appendAskBubble("error", '网络异常，请稍后再试　<button class="ask-retry" onclick="retryAsk()">重试</button>');
  });
}

// ---------- 重试：清掉上次的错误气泡与问题气泡（sendAsk 会重绘），直接发请求（重试是显式意图，不进 3 秒防重） ----------
function retryAsk() {
  if (askPending) { return; }
  document.querySelectorAll("#ask-list .ask-error").forEach(function (el) { el.remove(); });
  var questions = document.querySelectorAll("#ask-list .ask-question");
  if (questions.length) { questions[questions.length - 1].remove(); }
  if (!askLastQuestion) { return; }
  document.getElementById("ask-input").value = askLastQuestion;
  askLastTime = Date.now();
  sendAsk(askLastQuestion);
}

// ---------- 思考指示气泡：三点错峰跳动，回答到达后被替换 ----------
function appendThinkingBubble() {
  openAskPanel();
  var list = document.getElementById("ask-list");
  var bubble = document.createElement("div");
  bubble.className = "ask-msg ask-answer ask-thinking";
  bubble.innerHTML = "<span class='dot'></span><span class='dot'></span><span class='dot'></span>";
  list.appendChild(bubble);
  list.scrollTop = list.scrollHeight;
  scrollAskIntoView();
  return bubble;
}

// ---------- 追加气泡：assistant 用 marked 渲染 markdown（转义 < 和 &）；error 保留内嵌按钮用 innerHTML ----------
function appendAskBubble(role, content) {
  openAskPanel();
  var list = document.getElementById("ask-list");
  var bubble = document.createElement("div");
  if (role === "assistant") {
    bubble.className = "ask-msg ask-answer";
    var body = document.createElement("div");
    body.className = "md-body";
    body.innerHTML = marked.parse(String(content).replace(/&/g, "&amp;").replace(/</g, "&lt;"));
    bubble.appendChild(body);
  } else if (role === "error") {
    bubble.className = "ask-msg ask-answer ask-error";
    bubble.innerHTML = content;
  } else {
    bubble.className = "ask-msg ask-question";
    bubble.textContent = content;
  }
  list.appendChild(bubble);
  list.scrollTop = list.scrollHeight;
  scrollAskIntoView();
}

// ---------- 历史入栈：成功回答后调用（错误不入历史，避免污染上下文） ----------
function pushAskHistory(question, answer) {
  askHistory.push({ role: "user", content: question });
  askHistory.push({ role: "assistant", content: answer });
}

// ---------- 卡片展开/收起：展开走入场动画，收起立即隐藏（不延时） ----------
function openAskPanel() {
  document.getElementById("ask-panel").classList.remove("hidden");
}

function collapseAsk() {
  document.getElementById("ask-panel").classList.add("hidden");
}

// ---------- 展开时滚到可见位置（Hero 可能已滚出视口）；尊重系统"减弱动态效果" ----------
function scrollAskIntoView() {
  requestAnimationFrame(function () {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("ask-panel").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  });
}

// ---------- 提交中态：按钮禁用转圈 + 输入框禁用 ----------
function setAskLoading(loading) {
  var btn = document.getElementById("ask-btn");
  var icon = document.getElementById("ask-btn-icon");
  var input = document.getElementById("ask-input");
  btn.disabled = loading;
  input.disabled = loading;
  icon.textContent = loading ? "⟳" : "🧭";
  icon.classList.toggle("spin", loading);
  document.getElementById("ask-btn-label").textContent = loading ? "思考中…" : "问罗盘";
}

// ---------- 离开首页且不在自由问答页时清空历史：分段页/帮助页不保留旧对话 ----------
new MutationObserver(function () {
  if (!document.body.classList.contains("route-home") && !document.body.classList.contains("route-ask")) {
    askHistory = [];
    var list = document.getElementById("ask-list");
    var panel = document.getElementById("ask-panel");
    var input = document.getElementById("ask-input");
    if (list) { list.innerHTML = ""; }
    if (panel) { panel.classList.add("hidden"); }
    if (input) { input.value = ""; }
  }
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });

function fillAskExample(text) {
  var input = document.getElementById("ask-input");
  if (!input) { return; }
  input.value = text;
  input.focus();
}

function clearAskHistory() {
  askHistory = [];
  var list = document.getElementById("ask-list");
  if (list) { list.innerHTML = ""; }
  showToast("问答记录已清空");
}
