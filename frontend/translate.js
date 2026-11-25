/* 05 多语翻译：材料类型 + 目标语言 + 原文 + 可选术语，结果带中文对照 */

function initTranslatePage() {
  setupDocTypeOther();
  var group = document.getElementById("translate-lang-group");
  if (!group || group.dataset.ready === "1" || !window.CATALOG) { return; }
  group.dataset.ready = "1";
  group.innerHTML = CATALOG.languages.map(function (lang, index) {
    var active = index === 0 ? " active" : "";
    return '<button type="button" class="lang-btn' + active + '" data-lang="' + escapeHtml(lang.value) +
      '" onclick="toggleTranslateLang(this)">' + escapeHtml(lang.value) +
      '<span class="lang-zh">' + escapeHtml(lang.zh) + "</span></button>";
  }).join("");
}

function toggleTranslateLang(btn) {
  var selected = document.querySelectorAll("#translate-lang-group .lang-btn.active").length;
  if (!btn.classList.contains("active") && selected >= 3) {
    showToast("最多选择 3 种语言");
    return;
  }
  btn.classList.toggle("active");
}

function selectedTranslateLanguages() {
  return Array.prototype.map.call(
    document.querySelectorAll("#translate-lang-group .lang-btn.active"),
    function (btn) { return btn.dataset.lang; }
  );
}


function runTranslate() {
  initTranslatePage();
  var source = document.getElementById("translate-source");
  var text = source ? source.value.trim() : "";
  var languages = selectedTranslateLanguages();
  if (!text) {
    showRequiredModal("⚠️ 还差一步", "请先粘贴要翻译的原文，这是翻译的必要信息。", "translate-source");
    return;
  }
  if (!languages.length) {
    showRequiredModal("⚠️ 还差一步", "请选择至少 1 种目标语言。", "translate-lang-group");
    return;
  }
  var terms = ((document.getElementById("translate-terms") || {}).value || "").trim();
  var notice = document.getElementById("translate-missing-notice");
  if (!terms) {
    if (notice) { notice.classList.remove("hidden"); }
    return;
  }
  if (notice) { notice.classList.add("hidden"); }
  doTranslate();
}

function fillTranslateMissing() {
  var notice = document.getElementById("translate-missing-notice");
  if (notice) { notice.classList.add("hidden"); }
  var el = document.getElementById("translate-terms");
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flashField("translate-terms");
    setTimeout(function () { el.focus(); }, 350);
  }
}

function translateAnyway() {
  var notice = document.getElementById("translate-missing-notice");
  if (notice) { notice.classList.add("hidden"); }
  doTranslate();
}

function doTranslate() {
  initTranslatePage();
  var source = document.getElementById("translate-source");
  var text = source ? source.value.trim() : "";
  var languages = selectedTranslateLanguages();
  if (!text) {
    showToast("请先粘贴要翻译的原文");
    return;
  }
  if (!languages.length) {
    showToast("请选择至少 1 种目标语言");
    return;
  }
  var btn = document.getElementById("btn-translate");
  var icon = document.getElementById("translate-btn-icon");
  var label = document.getElementById("translate-btn-label");
  var status = document.getElementById("translate-status");
  if (btn) { btn.disabled = true; }
  if (icon) { icon.textContent = "⟳"; }
  if (label) { label.textContent = "翻译中…"; }
  if (status) {
    status.textContent = "正在翻译，保留型号、参数、单位和认证编号…";
    status.classList.remove("hidden", "demo-note");
    status.classList.add("text-brand");
  }
  if (typeof setAgentState === "function") { setAgentState("translate", "active"); }
  fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text,
      doc_type: readDocType(),
      languages: languages,
      terms: ((document.getElementById("translate-terms") || {}).value || "").trim()
    })
  }).then(function (resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
  }).then(function (res) {
    if (!res.ok || res.data.error) {
      throw new Error(res.data.error || "翻译失败");
    }
    renderTranslateResult(res.data.translation || "");
    if (status) {
      status.textContent = res.data.demo ? "🔧 演示模式：已生成翻译示例，未调用翻译模型；接入模型后会按原文翻译" : "翻译完成，请核对数字、型号和认证编号";
      status.classList.toggle("demo-note", !!res.data.demo);
      status.classList.toggle("text-brand", !res.data.demo);
    }
    if (typeof setAgentState === "function") { setAgentState("translate", "done"); }
  }).catch(function (err) {
    if (typeof setAgentState === "function") { setAgentState("translate", "error"); }
    showToast(err.message || "翻译失败，请重试");
    if (status) { status.classList.add("hidden"); }
  }).finally(function () {
    if (btn) { btn.disabled = false; }
    if (icon) { icon.textContent = "🌐"; }
    if (label) { label.textContent = "开始翻译"; }
  });
}

function renderTranslateResult(text) {
  var box = document.getElementById("translate-result");
  if (!box) { return; }
  if (!text) {
    window.lastTranslateResult = "";
    window.lastTranslateTime = null;
    box.classList.add("hidden");
    return;
  }
  window.lastTranslateResult = text;
  window.lastTranslateTime = Date.now() / 1000;
  if (typeof renderMarkdown === "function") {
    renderMarkdown("translate-result", text);
  } else {
    box.innerHTML = marked.parse(text);
  }
  box.classList.remove("hidden");
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function exportTranslate() {
  if (!window.lastTranslateResult) {
    showToast("请先翻译出结果");
    return;
  }
  openExportModal("translate", "word");
}

function copyTranslateResult() {
  var box = document.getElementById("translate-result");
  if (!box || box.classList.contains("hidden")) {
    showToast("还没有翻译结果");
    return;
  }
  var text = box.innerText;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      showToast("全文已复制");
    }).catch(function () {
      showToast("复制失败，请手动选择文本");
    });
  } else {
    showToast("当前浏览器不支持一键复制");
  }
}

function setupDocTypeOther() {
  var el = document.getElementById("translate-doc-type");
  var input = document.getElementById("translate-doc-type-other");
  if (!el || !input) { return; }
  if (el.dataset.otherReady !== "1") {
    el.dataset.otherReady = "1";
    el.addEventListener("change", function () { input.classList.toggle("hidden", el.value !== "其他"); });
  }
  input.classList.toggle("hidden", el.value !== "其他");
}

function readDocType() {
  var el = document.getElementById("translate-doc-type");
  if (!el) { return "商品上架文案"; }
  if (el.value === "其他") {
    var input = document.getElementById("translate-doc-type-other");
    return input && input.value.trim() ? input.value.trim() : "其他";
  }
  return el.value;
}

document.addEventListener("DOMContentLoaded", function () { initTranslatePage(); setupDocTypeOther(); });