/* =========================================================
   管理者モード（その場編集・GitHubに直接保存）
   index.html / diary.html の両方から読み込まれます。

   ・パスワードを変更したい場合は、下の ADMIN_PASSWORD を書き換えてください。
   ・リポジトリ名などを変更した場合は、下の GITHUB_* を書き換えてください。
   ・「保存する」を押すと、ここで設定したGitHubリポジトリの content.js に
   　直接コミットされます（GitHub Desktopでのcommit/pushは不要になります）。
   　保存には、書き込み権限のある GitHub の Personal Access Token が必要です
   　（初回のみ入力を求められ、以降はこの端末に保存されます）。
   ========================================================= */

(function () {
  "use strict";

  var ADMIN_PASSWORD = "tomo1112";

  var GITHUB_OWNER = "tomozyo2";
  var GITHUB_REPO = "technical-school-amagi";
  var GITHUB_BRANCH = "main";
  var GITHUB_PATH = "content.js";
  var TOKEN_KEY = "amagi-gh-pat";

  var HEADER = "/* =========================================================\n" +
    "   テクニカルスクール甘木 サイトのコンテンツ（文字情報）\n" +
    "   index.html / diary.html が共通で読み込みます。\n\n" +
    "   ★このファイルはサイト右上の「管理者」から編集・保存できます。\n" +
    "   　手動で書き換える場合は、ダブルクォート \" や カンマ , の\n" +
    "   　対応を崩さないよう注意してください（JSON形式です）。\n" +
    "   ========================================================= */\n\n";

  var data = null;
  var currentSha = null;
  var scrollTargetId = null;

  function apiUrl() {
    return "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + GITHUB_PATH + "?ref=" + GITHUB_BRANCH;
  }

  function b64ToUtf8(b64) {
    var binary = atob(b64.replace(/\n/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = "";
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

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

  /* ===== パスワード入力＋GitHubトークン入力モーダル ===== */
  var modalEl, pwStep, pwInput, tokenStep, tokenInput, modalErr, submitBtn, modalNote, modalTitle;
  var currentStep = "password";

  function buildModal() {
    modalEl = document.createElement("div");
    modalEl.className = "admin-modal-overlay";
    modalEl.style.display = "none";
    modalEl.innerHTML =
      '<div class="admin-modal-box">' +
      '  <div class="admin-modal-title">⚽ 管理者モード</div>' +
      '  <div id="pw-step">' +
      '    <p class="admin-modal-desc">パスワードを入力してください。</p>' +
      '    <input type="password" id="pw-input" autocomplete="off" placeholder="パスワード">' +
      '  </div>' +
      '  <div id="token-step" style="display:none;">' +
      '    <p class="admin-modal-desc">初回のみ、GitHubのアクセストークンを入力してください。<br>この端末に保存され、次回以降は不要です。</p>' +
      '    <input type="password" id="token-input" autocomplete="off" placeholder="ghp_... または github_pat_...">' +
      '  </div>' +
      '  <div class="admin-modal-err"></div>' +
      '  <div class="admin-modal-actions">' +
      '    <button type="button" class="admin-modal-btn ghost">キャンセル</button>' +
      '    <button type="button" class="admin-modal-btn primary">入る</button>' +
      '  </div>' +
      '  <p class="admin-modal-note"></p>' +
      '</div>';
    document.body.appendChild(modalEl);

    modalTitle = modalEl.querySelector(".admin-modal-title");
    pwStep = modalEl.querySelector("#pw-step");
    pwInput = modalEl.querySelector("#pw-input");
    tokenStep = modalEl.querySelector("#token-step");
    tokenInput = modalEl.querySelector("#token-input");
    modalErr = modalEl.querySelector(".admin-modal-err");
    modalNote = modalEl.querySelector(".admin-modal-note");
    var btns = modalEl.querySelectorAll(".admin-modal-btn");
    var cancelBtn = btns[0];
    submitBtn = btns[1];

    cancelBtn.addEventListener("click", closeLoginModal);
    submitBtn.addEventListener("click", submitStep);
    pwInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitStep(); });
    tokenInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitStep(); });
  }

  function openLoginModal() {
    currentStep = "password";
    pwStep.style.display = "block";
    tokenStep.style.display = "none";
    pwInput.value = "";
    modalErr.textContent = "";
    modalNote.textContent = "";
    submitBtn.disabled = false;
    modalEl.style.display = "flex";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { pwInput.focus(); });
    });
  }

  function showTokenStep() {
    currentStep = "token";
    pwStep.style.display = "none";
    tokenStep.style.display = "block";
    tokenInput.value = "";
    modalErr.textContent = "";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { tokenInput.focus(); });
    });
  }

  function closeLoginModal() {
    modalEl.style.display = "none";
  }

  function submitStep() {
    if (currentStep === "password") {
      if (pwInput.value !== ADMIN_PASSWORD) {
        modalErr.textContent = "パスワードが違います";
        return;
      }
      var savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        loadFromGitHub(savedToken);
      } else {
        showTokenStep();
      }
    } else if (currentStep === "token") {
      var token = tokenInput.value.trim();
      if (!token) {
        modalErr.textContent = "トークンを入力してください";
        return;
      }
      localStorage.setItem(TOKEN_KEY, token);
      loadFromGitHub(token);
    }
  }

  async function loadFromGitHub(token) {
    modalErr.textContent = "";
    modalNote.textContent = "読み込み中...";
    submitBtn.disabled = true;
    try {
      var res = await fetch(apiUrl(), {
        headers: {
          "Authorization": "token " + token,
          "Accept": "application/vnd.github+json"
        }
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        showTokenStep();
        modalNote.textContent = "";
        modalErr.textContent = "トークンが無効です。もう一度入力してください。";
        submitBtn.disabled = false;
        return;
      }
      if (!res.ok) throw new Error("読み込みに失敗しました（エラー" + res.status + "）");
      var json = await res.json();
      currentSha = json.sha;
      var text = b64ToUtf8(json.content);
      var match = text.match(/window\.SITE_CONTENT\s*=\s*([\s\S]*?);\s*$/);
      if (!match) throw new Error("content.js の中身を読み取れませんでした。");
      data = JSON.parse(match[1]);
      submitBtn.disabled = false;
      closeLoginModal();
      enterAdminMode();
    } catch (err) {
      modalNote.textContent = "";
      modalErr.textContent = (err && err.message) ? err.message : String(err);
      submitBtn.disabled = false;
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
    btns[0].addEventListener("click", saveToGitHub);
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

  async function uploadBinaryFile(path, dataUrl, token) {
    var base64 = dataUrl.split(",")[1];
    var url = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path;
    var sha = null;
    var getRes = await fetch(url + "?ref=" + GITHUB_BRANCH, {
      headers: { "Authorization": "token " + token, "Accept": "application/vnd.github+json" }
    });
    if (getRes.ok) {
      sha = (await getRes.json()).sha;
    } else if (getRes.status !== 404) {
      throw new Error("写真の確認に失敗しました（エラー" + getRes.status + "）");
    }
    var body = {
      message: "Instagram写真を更新（管理者モード） " + new Date().toLocaleString("ja-JP"),
      content: base64,
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    var putRes = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": "token " + token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!putRes.ok) {
      var errJson = await putRes.json().catch(function () { return {}; });
      throw new Error("写真のアップロードに失敗しました（エラー" + putRes.status + "）：" + (errJson.message || ""));
    }
  }

  async function saveToGitHub() {
    if (!data) return;
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      barMsg.textContent = "トークンが見つかりません。一度「終了する」してから、もう一度お入りください。";
      return;
    }
    barMsg.textContent = "保存中...";
    try {
      var pendingUploads = window.__adminPendingUploads;
      if (pendingUploads && pendingUploads.instagramPhoto) {
        barMsg.textContent = "写真をアップロード中...";
        await uploadBinaryFile("instagram-photo.jpg", pendingUploads.instagramPhoto, token);
        data.contact.instagramPhotoUpdatedAt = String(Date.now());
        pendingUploads.instagramPhoto = null;
        barMsg.textContent = "保存中...";
      }

      var json = JSON.stringify(data, null, 2);
      var output = HEADER + "window.SITE_CONTENT = " + json + ";\n";
      var res = await fetch(apiUrl().split("?")[0], {
        method: "PUT",
        headers: {
          "Authorization": "token " + token,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "サイト更新（管理者モード） " + new Date().toLocaleString("ja-JP"),
          content: utf8ToB64(output),
          sha: currentSha,
          branch: GITHUB_BRANCH
        })
      });
      if (!res.ok) {
        var errJson = await res.json().catch(function () { return {}; });
        throw new Error("保存に失敗しました（エラー" + res.status + "）：" + (errJson.message || ""));
      }
      var resJson = await res.json();
      currentSha = resJson.content.sha;
      barMsg.textContent = "✅ GitHubに保存しました（" + new Date().toLocaleTimeString("ja-JP") + "）。1分ほどでサイトに反映されます。";
    } catch (err) {
      barMsg.textContent = (err && err.message) ? err.message : String(err);
    }
  }

  function exitAdmin() {
    location.reload();
  }
})();
