/* 基础版 · Listing 区识图：只展示参考，不覆盖产品资料；用户可一键填回卖点和参数 */

var listingRecognized = null;

function setupListingUpload() {
  var zone = document.getElementById("listing-upload-zone");
  var input = document.getElementById("listing-image-input");
  if (!zone || !input) { return; }
  zone.addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function () {
    handleListingFile(input.files && input.files[0]);
  });
  zone.addEventListener("dragover", function (e) {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", function () { zone.classList.remove("dragover"); });
  zone.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("dragover");
    handleListingFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
}

function handleListingFile(file) {
  if (!file) { return; }
  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    showToast("只支持 JPG / PNG 图片");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("图片不能超过 20MB");
    return;
  }
  document.getElementById("listing-image-preview").src = URL.createObjectURL(file);
  document.getElementById("listing-image-name").textContent = file.name;
  document.getElementById("listing-upload-empty").classList.add("hidden");
  document.getElementById("listing-upload-filled").classList.remove("hidden");
  document.getElementById("listing-image-fallback").classList.add("hidden");
  analyzeListingImage(file);
}

function resetListingUpload() {
  var input = document.getElementById("listing-image-input");
  if (input) { input.value = ""; }
  var empty = document.getElementById("listing-upload-empty");
  var filled = document.getElementById("listing-upload-filled");
  if (empty) { empty.classList.remove("hidden"); }
  if (filled) { filled.classList.add("hidden"); }
  var box = document.getElementById("listing-image-result");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  var status = document.getElementById("listing-image-status");
  if (status) { status.classList.add("hidden"); status.textContent = ""; }
  listingRecognized = null;
}

function setListingStatus(msg, isError, isDemo) {
  var el = document.getElementById("listing-image-status");
  if (!el) { return; }
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.toggle("demo-note", !!isDemo && !isError);
  el.classList.toggle("text-brand", !isDemo && !isError);
  el.style.color = isError ? "#B91C1C" : "";
}

function analyzeListingImage(file) {
  var form = new FormData();
  form.append("file", file);
  setListingStatus("正在识别包装/详情页…", false);
  fetch("/api/analyze-image", { method: "POST", body: form })
    .then(function (resp) {
      return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
    })
    .then(function (res) {
      if (!res.ok) {
        setListingStatus(res.data.error || "识图失败", true);
        document.getElementById("listing-image-fallback").classList.remove("hidden");
        return;
      }
      if (res.data.error) {
        setListingStatus(res.data.error, true);
        return;
      }
      listingRecognized = res.data;
      renderListingRecognition(res.data);
      setListingStatus(res.data.demo ? "🔧 演示模式：已生成参考识别结果，未调用识图模型" : "识别完成，可把卖点和参数填回产品资料", false, !!res.data.demo);
    })
    .catch(function () {
      setListingStatus("网络错误，识图失败", true);
      document.getElementById("listing-image-fallback").classList.remove("hidden");
    });
}

function listingHasResult() {
  return !!(window.lastResult && window.lastResult.listing);
}

function updateListingSupplementState() {
  var note = document.getElementById("listing-supplement-note");
  if (!note) { return; }
  var has = listingHasResult();
  note.textContent = has
    ? "已生成结果在下方；补充图片只会补进结果，不会清空原内容。"
    : "生成结果会显示在下方；补充图片只补充信息，不会清空结果。";
  note.classList.toggle("is-generated", has);
}

function scrollToListingResult() {
  var el = document.getElementById("listing-content");
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

function renderListingRecognition(result) {
  var box = document.getElementById("listing-image-result");
  if (!box) { return; }
  var params = result.params || {};
  var paramText = Object.keys(params).map(function (k) {
    return k + "：" + params[k];
  }).join("；");
  var points = (result.selling_points || []).join("、");
  box.innerHTML =
    '<div class="listing-recog">' +
      '<p><strong>识别到：</strong>' + escapeHtml(result.product || "未识别出产品名") +
        (result.category ? " · " + escapeHtml(result.category) : "") + "</p>" +
      (points ? '<p><strong>卖点参考：</strong>' + escapeHtml(points) + "</p>" : "") +
      (paramText ? '<p><strong>参数参考：</strong>' + escapeHtml(paramText) + "</p>" : "") +
      '<p class="text-[12px] text-[#7C8DA6] mt-2">' + (listingHasResult() ? "已生成结果在下方，补充不会清空原内容。" : "还没有生成结果，可先把识别内容存为产品资料。") + "</p>" +
      '<button type="button" class="btn-secondary h-10 px-4 text-sm" onclick="applyListingRecognition()">' + (listingHasResult() ? "补充到下方已生成结果" : "保存为产品资料") + "</button>" +
    "</div>";
  box.classList.remove("hidden");
}

function applyListingRecognition() {
  if (!listingRecognized) { return; }
  if (listingHasResult()) {
    var lines = ["", "## 图片补充信息", ""];
    if (listingRecognized.product) { lines.push("- 产品：" + listingRecognized.product); }
    var addPoints = (listingRecognized.selling_points || []).join("、");
    if (addPoints) { lines.push("- 补充卖点：" + addPoints); }
    var addParams = Object.keys(listingRecognized.params || {}).map(function (k) {
      return k + "：" + listingRecognized.params[k];
    }).join("；");
    if (addParams) { lines.push("- 补充参数：" + addParams); }
    lines.push("", "> 以上为图片识别补充，原已生成内容未清空，请核对后使用。");
    window.lastResult.listing = (window.lastResult.listing || "") + lines.join("\n");
    renderMarkdown("listing-content", window.lastResult.listing);
    updateListingSupplementState();
    scrollToListingResult();
    showToast("已补充到已生成的 Listing 结果，原内容未清空");
    return;
  }
  var points = document.getElementById("selling-points");
  var params = document.getElementById("params");
  if (points && listingRecognized.selling_points && listingRecognized.selling_points.length) {
    points.value = listingRecognized.selling_points.join("、");
  }
  if (params && listingRecognized.params) {
    params.value = Object.keys(listingRecognized.params).map(function (k) {
      return k + "：" + listingRecognized.params[k];
    }).join("；");
  }
  showToast("已把 Listing 参考的卖点和参数填回产品资料");
}

document.addEventListener("DOMContentLoaded", function () {
  setupListingUpload();
  updateListingSupplementState();
  var content = document.getElementById("listing-content");
  if (content) {
    new MutationObserver(updateListingSupplementState).observe(content, { childList: true, subtree: true, characterData: true });
  }
});