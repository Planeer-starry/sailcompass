/* 出海罗盘 · 意图理解（一句话填表 + 小海螺生成分流）
   - 折叠区由本脚本注入侧边栏，不改 index.html 的表单结构
   - 小海螺判定为生成时，预填数据写 sessionStorage，进入工作台后自动填表并生成 */

var INTENT_PREFILL_KEY = "sailcompass_prefill";
var INTENT_MAX_LANGS = 3;
var INTENT_FIELD_LABELS = { category: "产品种类", platform: "目标平台", market: "目标站点/市场", languages: "目标语言" };

// ---------- 注入折叠区：位于产品资料标题下方（总览表单顶部） ----------
function mountIntentFold() {
  var heading = document.querySelector("#panel-overview .card-title") || document.querySelector("#sidebar .side-title");
  if (!heading || document.getElementById("intent-fold")) { return; }
  var fold = document.createElement("div");
  fold.id = "intent-fold";
  fold.className = "intent-fold";
  fold.innerHTML = `
    <button type="button" id="intent-toggle" class="intent-fold-head" onclick="toggleIntentFold()">
      <span id="intent-arrow" class="intent-arrow">▸</span>
      <span>💬 懒得填？一句话说清需求，帮你自动填</span>
    </button>
    <p id="intent-demo-tip" class="intent-demo-tip hidden">⚠️ 当前为演示模式，「一句话自动填」不可用；请先在设置中配置文本模型。</p>
    <div id="intent-body" class="intent-body hidden">
      <input id="intent-input" type="text" maxlength="200"
        placeholder="例如：我要卖不锈钢保温杯到美国 Amazon，写英文和西语文案"
        class="intent-input">
      <button type="button" id="intent-fill" class="btn-secondary intent-fill" onclick="fillFromIntent()">
        <span id="intent-fill-label">自动填</span>
      </button>
      <p id="intent-note" class="intent-note hidden"></p>
      <p id="intent-inferred" class="intent-inferred hidden"></p>
    </div>`;
  heading.insertAdjacentElement("afterend", fold);
  mountIntentLangBadge();
  syncIntentDemoTip();
}

// ---------- 演示模式黄字提示：health 判定或模式切换后同步显示 ----------
function syncIntentDemoTip() {
  var tip = document.getElementById("intent-demo-tip");
  if (!tip) { return; }
  tip.classList.toggle("hidden", !window.demoMode);
}

// ---------- 语言区小标：由推断出来的语言时显示「按站点推荐」 ----------
function mountIntentLangBadge() {
  var btns = document.querySelectorAll(".lang-btn");
  if (!btns.length || document.getElementById("intent-lang-badge")) { return; }
  var badge = document.createElement("p");
  badge.id = "intent-lang-badge";
  badge.className = "intent-lang-badge hidden";
  badge.textContent = "🤖 按站点推荐";
  btns[0].parentNode.insertAdjacentElement("afterend", badge);
}

// ---------- 展开/收起：display 切换，箭头只做 transform 旋转 ----------
function toggleIntentFold() {
  var body = document.getElementById("intent-body");
  var fold = document.getElementById("intent-fold");
  var open = body.classList.toggle("open");
  body.classList.toggle("hidden", !open);
  fold.classList.toggle("open", open);
}

// ---------- 入口 1：点「自动填」 ----------
function fillFromIntent() {
  if (window.demoMode) {
    notify("演示模式下「一句话自动填」不可用，请先在设置中配置文本模型");
    return;
  }
  var input = document.getElementById("intent-input");
  var text = input.value.trim();
  if (!text) { notify("请先描述一下你的需求"); return; }
  var btn = document.getElementById("intent-fill");
  var label = document.getElementById("intent-fill-label");
  btn.disabled = true;
  label.textContent = "解析中…";
  requestIntent(text).then(function (res) {
    if (!res.ok) { notify(res.data.error || "解析失败，请重试"); return; }
    applyIntentFields(res.data);
    notify("已根据描述填好，请补充标红的字段");
  }).catch(function () {
    notify("网络异常，请稍后重试");
  }).finally(function () {
    btn.disabled = false;
    label.textContent = "自动填";
  });
}

// ---------- 请求封装：/api/parse-intent ----------
function requestIntent(text) {
  return fetch("/api/parse-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text }),
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  });
}

// ---------- 填表：只写非空字段，不覆盖用户已有内容 ----------
function applyIntentFields(data) {
  setFieldIfPresent("product", data.product);
  setFieldIfPresent("selling-points", data.selling_points);
  setFieldIfPresent("params", data.params);
  setSelectIfPresent("category", data.category);
  setSelectIfPresent("platform", data.platform);
  setSelectIfPresent("market", data.market);
  applyLanguages(data.languages);
  var inferred = Array.isArray(data.inferred) ? data.inferred : [];
  renderIntentNote(data.note);
  renderInferred(inferred);
  renderLangBadge(inferred);
}

function setFieldIfPresent(id, value) {
  if (!value) { return; }
  var el = document.getElementById(id);
  if (el) { el.value = value; }
}

function setSelectIfPresent(id, value) {
  if (!value) { return; }
  var select = document.getElementById(id);
  if (!select) { return; }
  var matched = Array.prototype.some.call(select.options, function (opt) {
    return opt.value === value || opt.textContent.trim() === value;
  });
  if (matched) { select.value = value; }
}

// ---------- 语言按钮：返回非空才覆盖，最多选 3 个 ----------
function applyLanguages(languages) {
  if (!document.getElementById("lang-group")) { return; }
  if (!Array.isArray(languages) || languages.length === 0) { return; }
  var picked = 0;
  document.querySelectorAll(".lang-btn").forEach(function (btn) {
    var value = btn.dataset.lang || btn.textContent.trim();
    if (picked < INTENT_MAX_LANGS && languages.indexOf(value) !== -1) {
      btn.classList.add("active");
      picked++;
    } else {
      btn.classList.remove("active");
    }
  });
}

// ---------- 黄色提示：没听出来的字段 ----------
function renderIntentNote(note) {
  var el = document.getElementById("intent-note");
  if (!el) { return; }
  var text = (note || "").trim();
  el.textContent = text ? "没听出来：" + text : "";
  el.classList.toggle("hidden", !text);
}

// ---------- 推断标注：英文字段名映射成中文，提示哪些字段是模型推断的 ----------
function renderInferred(inferred) {
  var el = document.getElementById("intent-inferred");
  if (!el) { return; }
  var labels = inferred.map(function (field) { return INTENT_FIELD_LABELS[field]; })
    .filter(Boolean);
  var text = labels.length ? "🤖 已按语义推断：" + labels.join("、") : "";
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

function renderLangBadge(inferred) {
  var el = document.getElementById("intent-lang-badge");
  if (!el) { return; }
  el.classList.toggle("hidden", inferred.indexOf("languages") === -1);
}

// ---------- 入口 2：小海螺先判意图，生成型才跳工作台 ----------
function routeAskIntent(question, thinking) {
  requestIntent(question).then(function (res) {
    if (res.ok && res.data.intent === "generate" && res.data.product) {
      thinking.remove();
      saveIntentPrefill(res.data);
      appendAskBubble("assistant", "已按你的描述填好了，正在为你生成 →");
      // 留 500ms 让提示可见；跳转后再复位提交态，避免期间重复提交
      setTimeout(function () {
        location.hash = "#/report";
        askPending = false;
        setAskLoading(false);
      }, 500);
      return;
    }
    requestAskAnswer(question, thinking);
  }).catch(function () {
    // 意图接口不可用：退回原咨询路径，不影响小海螺
    requestAskAnswer(question, thinking);
  });
}

function saveIntentPrefill(data) {
  try { sessionStorage.setItem(INTENT_PREFILL_KEY, JSON.stringify(data)); }
  catch (e) { /* 存储不可用：仅提示，无法预填 */ }
}

// ---------- 进入工作台消费预填：填表 → 清键 → 自动生成 ----------
function consumeIntentPrefill() {
  if (location.hash !== "#/report" && location.hash !== "#/report/insight") { return; }
  var data = readIntentPrefill();
  if (!data) { return; }
  clearIntentPrefill();
  applyIntentFields(data);
  if (typeof generateAll === "function") { generateAll(); }
}

function readIntentPrefill() {
  try {
    var raw = sessionStorage.getItem(INTENT_PREFILL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearIntentPrefill() {
  try { sessionStorage.removeItem(INTENT_PREFILL_KEY); }
  catch (e) { /* 忽略 */ }
}

// ---------- toast 兜底：app.js 未加载时只写控制台 ----------
function notify(msg) {
  if (typeof showToast === "function") { showToast(msg); }
  else { console.warn(msg); }
}

document.addEventListener("DOMContentLoaded", function () {
  mountIntentFold();
  consumeIntentPrefill();
  document.addEventListener("demo-mode-change", syncIntentDemoTip);
});
window.addEventListener("hashchange", consumeIntentPrefill);