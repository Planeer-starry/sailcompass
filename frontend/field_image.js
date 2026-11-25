/* 字段旁识图：产品名称 / 卖点 / 参数 / 翻译原文共用
   - 用户不用选类型，后端 image_type 自己判断；前端按判断结果填对应字段
*/

var fieldImageTarget = "";
var fieldImageInput = null;

function ensureFieldImageInput() {
  if (fieldImageInput) { return fieldImageInput; }
  fieldImageInput = document.createElement("input");
  fieldImageInput.type = "file";
  fieldImageInput.accept = "image/jpeg,image/png";
  fieldImageInput.className = "hidden";
  fieldImageInput.style.display = "none";
  fieldImageInput.addEventListener("change", function () {
    handleFieldImage(fieldImageInput.files && fieldImageInput.files[0]);
  });
  document.body.appendChild(fieldImageInput);
  return fieldImageInput;
}

function pickFieldImage(target) {
  fieldImageTarget = target || "product";
  var input = ensureFieldImageInput();
  input.value = "";
  input.click();
}

function handleFieldImage(file) {
  if (!file) { return; }
  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    showToast("只支持 JPG / PNG 图片");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("图片不能超过 20MB");
    return;
  }
  showToast("正在识图，AI 会自动判断是产品、卖点、参数还是翻译材料…", 3000);
  var form = new FormData();
  form.append("file", file);
  fetch("/api/analyze-image", { method: "POST", body: form })
    .then(function (resp) {
      return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
    })
    .then(function (res) {
      if (!res.ok || res.data.error) {
        throw new Error(res.data.error || "识图失败");
      }
      applyFieldImageResult(res.data);
    })
    .catch(function (err) {
      showToast(err.message || "识图失败，请重试");
    });
}

function applyFieldImageResult(result) {
  var type = (result.image_type || fieldImageTarget || "product").trim();
  if (type === "translation") {
    var sourceText = (result.source_text || "").trim();
    var source = document.getElementById("translate-source");
    if (source && sourceText) {
      source.value = sourceText;
      showToast("识别为翻译材料，原文已填入翻译框");
      return;
    }
    if (source && result.product) {
      source.value = [result.product, (result.selling_points || []).join("、")]
        .filter(Boolean).join("\n");
      showToast("识别到文字，已填入翻译框，请核对");
      return;
    }
    showToast("这张图没有识别到可翻译的原文");
    return;
  }

  if (type === "selling_points") {
    var points = (result.selling_points || []).join("、");
    if (points) {
      document.getElementById("selling-points").value = points;
      showToast("识别为卖点，已填入核心卖点");
      return;
    }
  }

  if (type === "params") {
    var params = result.params || {};
    var text = Object.keys(params).map(function (key) { return key + "：" + params[key]; }).join("；");
    if (text) {
      document.getElementById("params").value = text;
      showToast("识别为参数，已填入产品参数");
      return;
    }
  }

  if (type === "product" || fieldImageTarget === "product") {
    var product = document.getElementById("product");
    var category = document.getElementById("category");
    if (product && result.product) { product.value = result.product; }
    if (category && result.category) {
      var exists = Array.prototype.some.call(category.options, function (opt) {
        return opt.value === result.category;
      });
      if (exists) { category.value = result.category; }
    }
    var pts = (result.selling_points || []).join("、");
    var paramText = Object.keys(result.params || {}).map(function (key) {
      return key + "：" + result.params[key];
    }).join("；");
    var sp = document.getElementById("selling-points");
    var paramEl = document.getElementById("params");
    if (sp && pts) { sp.value = pts; }
    if (paramEl && paramText) { paramEl.value = paramText; }
    showToast(product && result.product ? "识别为产品，已填入产品名称、类目、卖点和参数" : "没有识别到产品信息");
    return;
  }

  showToast("没有识别到可填入的内容，请手动填写");
}