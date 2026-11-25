/* 出海罗盘 v1 · 产品字典：站点/平台/种类/语言，页面加载时填充表单
   - 平台 = 渠道（Amazon、TikTok Shop…）
   - 站点 = 市场（美国、德国、日本…国别或地区）
   - 语言按钮同时显示原文和中文，老板群体不需要先懂外语
*/

var CATALOG = {
  categories: [
    "3C电子", "家居生活", "家具家居", "户外运动", "户外用品", "美妆个护",
    "母婴玩具", "医疗器械", "宠物用品", "服饰鞋包", "服装鞋帽", "皮具箱包", "食品饮料",
    "汽车用品", "汽车配件", "五金工具", "办公文具", "珠宝饰品", "运动健身",
    "园艺工具", "其他"
  ],
  platforms: [
    { group: "主流平台", items: ["Amazon", "TikTok Shop", "Shopee", "Temu", "AliExpress", "eBay", "Walmart"] },
    { group: "区域平台", items: ["Lazada", "Mercado Libre", "Rakuten", "Coupang"] },
    { group: "自建渠道", items: ["独立站"] },
    { group: "其他", items: ["其他"] }
  ],
  markets: [
    { group: "北美", items: ["美国", "加拿大", "墨西哥"] },
    { group: "欧洲", items: ["英国", "德国", "法国", "意大利", "西班牙", "荷兰", "波兰", "瑞典"] },
    { group: "亚太", items: ["日本", "韩国", "新加坡", "马来西亚", "泰国", "越南", "菲律宾", "印度尼西亚", "澳大利亚", "新西兰", "印度"] },
    { group: "中东", items: ["沙特阿拉伯", "阿联酋", "以色列"] },
    { group: "拉美", items: ["巴西", "智利", "哥伦比亚"] },
    { group: "非洲", items: ["南非", "尼日利亚"] },
    { group: "其他", items: ["全球市场"] }
  ],
  languages: [
    { value: "English", zh: "英语" },
    { value: "Español", zh: "西班牙语" },
    { value: "Deutsch", zh: "德语" },
    { value: "Français", zh: "法语" },
    { value: "Italiano", zh: "意大利语" },
    { value: "Português", zh: "葡萄牙语" },
    { value: "日本語", zh: "日语" },
    { value: "한국어", zh: "韩语" },
    { value: "العربية", zh: "阿拉伯语" },
    { value: "ไทย", zh: "泰语" },
    { value: "Tiếng Việt", zh: "越南语" },
    { value: "Bahasa Indonesia", zh: "印尼语" },
    { value: "Bahasa Melayu", zh: "马来语" },
    { value: "Türkçe", zh: "土耳其语" },
    { value: "Nederlands", zh: "荷兰语" },
    { value: "Polski", zh: "波兰语" }
  ],
  defaultLanguages: ["English", "Español"]
};

window.CATALOG = CATALOG;

// ---------- 填充普通下拉：占位 + 分组 + 「帮我推荐」 ----------
function fillCatalogSelect(id, groups, placeholder) {
  var el = document.getElementById(id);
  if (!el) { return; }
  var html = '<option value="" disabled selected hidden>' + placeholder + "</option>";
  groups.forEach(function (group) {
    if (group.group) {
      html += '<optgroup label="' + escapeHtml(group.group) + '">';
      group.items.forEach(function (item) {
        html += '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + "</option>";
      });
      html += "</optgroup>";
    } else {
      html += '<option value="' + escapeHtml(group) + '">' + escapeHtml(group) + "</option>";
    }
  });
  html += '<option value="帮我推荐">🤔 帮我推荐</option>';
  el.innerHTML = html;
  setupCatalogOther(id);
}

// 所有固定下拉：其他 + 可选自填（不填也允许）
function setupCatalogOther(id) {
  var el = document.getElementById(id);
  if (!el) { return; }
  var other = el.querySelector('option[value="其他"]');
  if (!other) {
    other = document.createElement("option");
    other.value = "其他";
    el.appendChild(other);
  }
  other.textContent = "其他（自己填）";
  var input = document.getElementById(id + "-other");
  if (!input) {
    input = document.createElement("input");
    input.id = id + "-other";
    input.className = "form-input select-other-input hidden";
    input.placeholder = "选「其他」时，可以自己填，不填也行";
    el.insertAdjacentElement("afterend", input);
  }
  if (el.dataset.otherReady !== "1") {
    el.dataset.otherReady = "1";
    el.addEventListener("change", function () { syncCatalogOther(id); });
  }
  syncCatalogOther(id);
}

function syncCatalogOther(id) {
  var el = document.getElementById(id);
  var input = document.getElementById(id + "-other");
  if (!el || !input) { return; }
  input.classList.toggle("hidden", el.value !== "其他");
}

function readCatalogValue(id) {
  var el = document.getElementById(id);
  if (!el) { return ""; }
  if (el.value === "其他") {
    var input = document.getElementById(id + "-other");
    return input && input.value.trim() ? input.value.trim() : "其他";
  }
  return el.value;
}

// ---------- 填充语言按钮：原文 + 中文，默认选两个 ----------
function fillCatalogLanguages() {
  var box = document.getElementById("lang-group");
  if (!box) { return; }
  box.innerHTML = CATALOG.languages.map(function (lang) {
    var active = CATALOG.defaultLanguages.indexOf(lang.value) !== -1 ? " active" : "";
    return '<button type="button" class="lang-btn' + active + '" data-lang="' + escapeHtml(lang.value) +
      '" onclick="toggleLang(this)">' + escapeHtml(lang.value) +
      '<span class="lang-zh">' + escapeHtml(lang.zh) + "</span></button>";
  }).join("");
}

// ---------- 统一初始化：所有页面共用同一份数据 ----------
function initCatalog() {
  fillCatalogSelect("category", CATALOG.categories, "请选择产品种类");
  fillCatalogSelect("platform", CATALOG.platforms, "请选择目标平台");
  fillCatalogSelect("market", CATALOG.markets, "请选择目标站点 / 市场");
  fillCatalogLanguages();
  window.IMAGE_CATEGORIES = CATALOG.categories;
}

document.addEventListener("DOMContentLoaded", initCatalog);

// 目标语言：给 Listing 页的“这一段翻译什么”做实时对照
function updateTranslationLanguages() {
  var el = document.getElementById("translation-languages");
  if (!el) { return; }
  var langs = [];
  document.querySelectorAll(".lang-btn.active").forEach(function (b) {
    var zh = b.querySelector(".lang-zh");
    langs.push((b.dataset.lang || "") + (zh ? " " + zh.textContent : ""));
  });
  el.textContent = langs.length ? "当前目标语言：" + langs.join(" / ") : "尚未选择目标语言";
}
document.addEventListener("DOMContentLoaded", updateTranslationLanguages);
