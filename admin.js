/* =========================================================
   管理者モード（その場編集）
   index.html / diary.html の両方から読み込まれます。

   パスワードを変更したい場合は、下の ADMIN_PASSWORD の
   文字列を書き換えてください。
   ========================================================= */

(function () {
  "use strict";

  var ADMIN_PASSWORD = "tomo1112";
  var supportsFS = !!window.showOpenFilePicker;

  var HEADER = "/* =========================================================\n" +
    "   テクニカルスクール甘木 サイトのコンテンツ（文字情報）\n" +
    "   index.html / diary.html が共通で読み込みます。\n\n" +
    "   ★このファイルはサイト右上の「管理者」から編集・保存できます。\n" +
    "   　手動で書き換える場合は、ダブルクォート \" や カンマ , の\n" +
    "   　対応を崩さないよう注意してください（JSON形式です）。\n" +
    "   ========================================================= */\n\n";

  var fileHandle = null;
  var data = null;
  var scrollTargetId = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    var navLink = document.getElementById("admin-toggle-link");
    var diaryLink = document.getElementById("diary-admin-toggle-link");
    if (!navLink && !diaryLink) return;
    buildModal();
    buildBar();
    if (navLink) navLink.addEventListener("click", function (e) { e.preventDefault(); handleTrigger(null); });
    if (diaryLink) diaryLink.addEventListener("click", function (e) { e.preventDefault(); handleTrigger("diary"); });
  }

  function handleTrigger(targetId) {
    if (data) {
      if (targetId) scrollToTarget(targetId); // 既に編集モード中はスクロールだけ行う
      return;
    }
    scrollTargetId = targetId;
    openLoginModal();
  }

  function scrollToTarget(id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ===== パスワード入力＋ファイル選択モーダル ===== */
  var modalEl, pwInput, pwErr, pwSubmit, pwNote;

  function buildModal() {
    modalEl = document.createElement("div");
    modalEl.className = "admin-modal-overlay";
    modalEl.style.display = "none";
    modalEl.innerHTML =
      '<div class="admin-modal-box">' +
      '  <div class="admin-modal-title">⚽ 管理者モード</div>' +
      '  <p class="admin-modal-desc">パスワードを入力してください。<br>続けて content.js ファイルを選択します。</p>' +
      '  <input type="password" autocomplete="off" placeholder="パスワード">' +
      '  <div class="admin-modal-err"></div>' +
      '  <div class="admin-modal-actions">' +
      '    <button type="button" class="admin-modal-btn ghost">キャンセル</button>' +
      '    <button type="button" class="admin-modal-btn primary">入る</button>' +
      '  </div>' +
      '  <p class="admin-modal-note"></p>' +
      '</div>';
    document.body.appendChild(modalEl);

    pwInput = modalEl.querySelector("input");
    pwErr = modalEl.querySelector(".admin-modal-err");
    pwNote = modalEl.querySelector(".admin-modal-note");
    var btns = modalEl.querySelectorAll(".admin-modal-btn");
    var cancelBtn = btns[0];
    pwSubmit = btns[1];

    cancelBtn.addEventListener("click", closeLoginModal);
    pwSubmit.addEventListener("click", submitPassword);
    pwInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitPassword();
    });

    if (!supportsFS) {
      pwNote.textContent = "この機能は Microsoft Edge または Google Chrome でのみご利用いただけます。";
      pwSubmit.disabled = true;
    }
  }

  function openLoginModal() {
    pwInput.value = "";
    pwErr.textContent = "";
    modalEl.style.display = "flex";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { pwInput.focus(); });
    });
  }

  function closeLoginModal() {
    modalEl.style.display = "none";
  }

  function submitPassword() {
    if (!supportsFS) return;
    if (pwInput.value !== ADMIN_PASSWORD) {
      pwErr.textContent = "パスワードが違います";
      return;
    }
    pickFile();
  }

  async function pickFile() {
    try {
      var handles = await window.showOpenFilePicker({
        types: [{ description: "content.js", accept: { "text/javascript": [".js"] } }],
        excludeAcceptAllOption: false,
        multiple: false
      });
      fileHandle = handles[0];
      var file = await fileHandle.getFile();
      var text = await file.text();
      var match = text.match(/window\.SITE_CONTENT\s*=\s*([\s\S]*?);\s*$/);
      if (!match) {
        pwErr.textContent = "content.js の中身を読み取れませんでした。";
        return;
      }
      data = JSON.parse(match[1]);
      closeLoginModal();
      enterAdminMode();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      pwErr.textContent = "ファイルを開けませんでした：" + err;
    }
  }

  /* ===== 編集モード本体 ===== */
  var barEl, barMsg;

  function buildBar() {
    barEl = document.createElement("div");
    barEl.id = "admin-bar";
    barEl.style.display = "none";
    barEl.innerHTML =
      '<span class="admin-bar-label">🔓 編集モード</span>' +
      '<span class="admin-bar-msg"></span>' +
      '<button type="button" class="admin-bar-btn primary">💾 保存する</button>' +
      '<button type="button" class="admin-bar-btn">終了する</button>';
    document.body.appendChild(barEl);
    barMsg = barEl.querySelector(".admin-bar-msg");
    var btns = barEl.querySelectorAll(".admin-bar-btn");
    btns[0].addEventListener("click", saveFile);
    btns[1].addEventListener("click", exitAdmin);
  }

  function rerenderAdmin() {
    window.renderSite(data, { editable: true, onChange: rerenderAdmin });
  }

  function enterAdminMode() {
    document.body.classList.add("admin-mode-on");
    rerenderAdmin();
    barEl.style.display = "flex";
    barMsg.textContent = "編集して「保存する」を押してください。";
    if (scrollTargetId) {
      scrollToTarget(scrollTargetId);
      scrollTargetId = null;
    }
  }

  async function saveFile() {
    if (!fileHandle || !data) return;
    try {
      var json = JSON.stringify(data, null, 2);
      var output = HEADER + "window.SITE_CONTENT = " + json + ";\n";
      var writable = await fileHandle.createWritable();
      await writable.write(output);
      await writable.close();
      barMsg.textContent = "✅ 保存しました（" + new Date().toLocaleTimeString("ja-JP") + "）";
    } catch (err) {
      barMsg.textContent = "保存に失敗しました：" + err;
    }
  }

  function exitAdmin() {
    location.reload();
  }
})();
