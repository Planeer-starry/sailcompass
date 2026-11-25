/* 出海罗盘 · 设置视图（#/settings）：模型配置面板 + 服务商预设
   - 配置只存 localStorage（sailcompass_llm_config），请求时由 demo.js 注入 X-LLM-* 头
   - renderSettings() 首次注入 DOM，之后每次进入只刷新状态条 */

const PROVIDER_PRESETS = [
  {id:"zhipu", name:"智谱 AI", badge:"全部免费",
   base_url:"https://open.bigmodel.cn/api/paas/v4",
   text_model:"glm-4-flash", vision_model:"glm-4v-flash",
   image_model:"cogview-3-flash", free:true,
   note:"文本、识图、生图都有免费额度，注册即用"},
  {id:"deepseek", name:"DeepSeek", badge:"便宜",
   base_url:"https://api.deepseek.com/v1",
   text_model:"deepseek-chat", vision_model:"deepseek-flash",
   image_model:"", free:false,
   note:"国内直连快，文本便宜；不支持生图"},
  {id:"siliconflow", name:"硅基流动", badge:"送额度",
   base_url:"https://api.siliconflow.cn/v1",
   text_model:"Qwen/Qwen2.5-7B-Instruct",
   vision_model:"Qwen/Qwen2.5-VL-7B-Instruct",
   image_model:"", free:true,
   note:"注册送额度；不支持生图"},
  {id:"custom", name:"自定义", badge:"",
   base_url:"", text_model:"", vision_model:"", image_model:"",
   free:false, note:"任何兼容 OpenAI 协议的服务"}
];

var SETTINGS_CONFIG_KEY = "sailcompass_llm_config";
var settingsRendered = false;
var selectedPresetId = "zhipu";

function renderSettings() {
  ensureSettingsStyle();
  if (!settingsRendered) {
    settingsRendered = true;
    mountSettingsPanel();
    bindSettingsEvents();
  }
  refreshSettingsStatus();
}

// ---------- 面板骨架：本次只做配置，不嵌入业务结果 ----------
function mountSettingsPanel() {
  document.getElementById("view-settings").innerHTML = `
    <div class="home-wrap settings-wrap">
      <section class="settings-panel">
        <h2 class="settings-title">模型配置</h2>

        <div class="settings-block">
          <h3 class="settings-subtitle">当前状态</h3>
          <div class="settings-status">
            <div class="settings-status-row"><span>文本模型</span><span id="status-text" class="settings-status-value">读取中…</span><i id="dot-text" class="settings-dot"></i></div>
            <div class="settings-status-row"><span>视觉模型</span><span id="status-vision" class="settings-status-value">读取中…</span><i id="dot-vision" class="settings-dot"></i></div>
            <div class="settings-status-row"><span>生图模型</span><span id="status-image" class="settings-status-value">读取中…</span><i id="dot-image" class="settings-dot"></i></div>
          </div>
        </div>

        <div class="settings-block">
          <h3 class="settings-subtitle">选择服务商</h3>
          <div id="provider-grid" class="provider-grid"></div>
        </div>

        <div class="settings-block">
          <h3 class="settings-subtitle">配置</h3>
          <label class="settings-field"><span>服务商地址</span><input id="cfg-base-url" type="text" readonly></label>
          <label class="settings-field"><span>API Key</span><input id="cfg-api-key" type="password" placeholder="粘贴你的密钥" autocomplete="off"></label>
          <label class="settings-field"><span>文本模型</span><input id="cfg-text-model" type="text" readonly></label>
          <label class="settings-field"><span>视觉模型</span><input id="cfg-vision-model" type="text" readonly></label>
          <label class="settings-field"><span>生图模型</span><input id="cfg-image-model" type="text" readonly></label>
        </div>

        <div class="settings-actions">
          <button id="btn-test-config" type="button" class="btn-secondary h-11 px-5 text-sm">测试连通</button>
          <button id="btn-save-config" type="button" class="btn-primary h-11 px-5 text-sm">保存配置</button>
        </div>
        <p id="test-result" class="settings-test-result hidden"></p>

        <div class="settings-footer">
          <button id="btn-clear-config" type="button" class="settings-clear">清除配置，恢复默认</button>
          <p class="settings-note">配置只保存在你自己的浏览器里，不会上传到服务器</p>
        </div>
      </section>

      <div class="settings-placeholder">
        <p class="settings-icon">⚙️</p>
        <p class="settings-text">配置保存在浏览器本地；保存后点顶部开关切回正常模式</p>
      </div>
    </div>`;
  renderProviderCards();
  fillFormFromSaved();
}

function bindSettingsEvents() {
  document.getElementById("provider-grid").addEventListener("click", function (e) {
    var card = e.target.closest(".provider-card");
    if (card) { selectProvider(card.dataset.id); }
  });
  document.getElementById("btn-test-config").addEventListener("click", testConfig);
  document.getElementById("btn-save-config").addEventListener("click", saveConfig);
  document.getElementById("btn-clear-config").addEventListener("click", clearConfig);
}

// ---------- 服务商卡片：选中态边框 + 勾号 ----------
function renderProviderCards() {
  document.getElementById("provider-grid").innerHTML = PROVIDER_PRESETS.map(function (p) {
    var picked = p.id === selectedPresetId;
    return '<button type="button" class="provider-card' + (picked ? " is-selected" : "") + '" data-id="' + p.id + '">' +
      '<span class="provider-check">' + (picked ? "✓" : "") + "</span>" +
      '<span class="provider-name">' + p.name + "</span>" +
      (p.badge ? '<span class="provider-badge">' + p.badge + "</span>" : "") +
      '<span class="provider-note">' + p.note + "</span>" +
      "</button>";
  }).join("");
}

function selectProvider(id) {
  selectedPresetId = id;
  applyPresetValues(presetById(id), id === "custom");
  renderProviderCards();
}

function applyPresetValues(preset, custom) {
  var fields = { base_url: "cfg-base-url", text_model: "cfg-text-model", vision_model: "cfg-vision-model", image_model: "cfg-image-model" };
  Object.keys(fields).forEach(function (key) {
    var el = document.getElementById(fields[key]);
    el.value = custom ? "" : (preset[key] || "");
    el.readOnly = !custom;
  });
}

function presetById(id) {
  for (var i = 0; i < PROVIDER_PRESETS.length; i++) {
    if (PROVIDER_PRESETS[i].id === id) { return PROVIDER_PRESETS[i]; }
  }
  return PROVIDER_PRESETS[0];
}

// ---------- 回填：有本地配置优先，否则默认第一个预设 ----------
function fillFormFromSaved() {
  var saved = readSavedConfig();
  if (saved && saved.preset) { selectedPresetId = saved.preset; }
  var custom = selectedPresetId === "custom";
  applyPresetValues(presetById(selectedPresetId), custom);
  document.getElementById("cfg-api-key").value = saved ? (saved.api_key || "") : "";
  if (saved) {
    document.getElementById("cfg-base-url").value = saved.base_url || "";
    document.getElementById("cfg-text-model").value = saved.text_model || "";
    document.getElementById("cfg-vision-model").value = saved.vision_model || "";
    document.getElementById("cfg-image-model").value = saved.image_model || "";
  }
  renderProviderCards();
}

function readSavedConfig() {
  try {
    var raw = localStorage.getItem(SETTINGS_CONFIG_KEY);
    if (!raw) { return null; }
    var cfg = JSON.parse(raw);
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch (e) {
    return null;
  }
}

// ---------- 状态条：三种能力各一行，绿点=已配置 ----------
function refreshSettingsStatus() {
  fetch("/api/health").then(function (resp) { return resp.json(); }).then(function (h) {
    setStatus("text", h.text_configured, h.text_configured ? (h.text_model || "已配置") : "未配置（演示模式）");
    setStatus("vision", h.vision_configured, h.vision_configured ? "已配置" : "未配置");
    setStatus("image", h.image_configured, h.image_configured ? "已配置" : "未配置");
  }).catch(function () {
    setStatus("text", false, "读取失败");
    setStatus("vision", false, "读取失败");
    setStatus("image", false, "读取失败");
  });
}

function setStatus(key, ok, text) {
  var value = document.getElementById("status-" + key);
  var dot = document.getElementById("dot-" + key);
  if (value) { value.textContent = text; }
  if (dot) { dot.classList.toggle("is-on", !!ok); }
}

// ---------- 测试连通 / 保存 / 清除 ----------
function collectFormConfig() {
  return {
    preset: selectedPresetId,
    base_url: document.getElementById("cfg-base-url").value.trim(),
    api_key: document.getElementById("cfg-api-key").value.trim(),
    text_model: document.getElementById("cfg-text-model").value.trim(),
    vision_model: document.getElementById("cfg-vision-model").value.trim(),
    image_model: document.getElementById("cfg-image-model").value.trim(),
  };
}

function testConfig() {
  var cfg = collectFormConfig();
  var result = document.getElementById("test-result");
  result.classList.remove("hidden");
  result.className = "settings-test-result";
  result.textContent = "测试中…";
  fetch("/api/test-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.text_model }),
  }).then(function (resp) { return resp.json(); }).then(function (data) {
    if (data.ok) {
      result.className = "settings-test-result is-ok";
      result.textContent = "✅ 连通正常（" + data.latency_ms + "ms）";
    } else {
      result.className = "settings-test-result is-error";
      result.textContent = "❌ 失败：" + (data.error || "未知错误");
    }
  }).catch(function () {
    result.className = "settings-test-result is-error";
    result.textContent = "❌ 失败：网络异常";
  });
}

function saveConfig() {
  var cfg = collectFormConfig();
  if (!cfg.base_url || !cfg.api_key || !cfg.text_model) {
    showToast("请填写服务商地址、API Key 和文本模型");
    return;
  }
  try {
    localStorage.setItem(SETTINGS_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {
    showToast("浏览器存储不可用，配置未保存");
    return;
  }
  if (typeof installApiHeaderFetch === "function") { installApiHeaderFetch(); }
  refreshSettingsStatus();
  showToast("已保存，点顶部开关切回正常模式");
}

function clearConfig() {
  try { localStorage.removeItem(SETTINGS_CONFIG_KEY); }
  catch (e) { /* 存储不可用：无需清理 */ }
  selectedPresetId = "zhipu";
  applyPresetValues(presetById("zhipu"), false);
  document.getElementById("cfg-api-key").value = "";
  document.getElementById("test-result").classList.add("hidden");
  renderProviderCards();
  refreshSettingsStatus();
  showToast("已恢复 .env 默认配置");
}

// ---------- 样式按需注入：motion.css 已 400 行，面板样式独立成 settings.css ----------
function ensureSettingsStyle() {
  if (document.getElementById("settings-style")) { return; }
  var link = document.createElement("link");
  link.id = "settings-style";
  link.rel = "stylesheet";
  link.href = "/static/settings.css";
  document.head.appendChild(link);
}