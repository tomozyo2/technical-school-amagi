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
  var GITHUB_PATH_DIARY = "diary-data.js";
  var GITHUB_PATH_MANGA = "manga-data.js";
  var SITE_URL = "https://" + GITHUB_OWNER + ".github.io/" + GITHUB_REPO + "/";
  var TOKEN_KEY = "amagi-gh-pat";
  var AUTH_KEY = "amagi-admin-auth-until";
  var AUTH_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // パスワード入力を省略できる期間（30日）

  var GOATCOUNTER_SITE = "amagi-technical";
  var GOATCOUNTER_TOKEN_KEY = "amagi-gc-token";

  var HEADER = "/* =========================================================\n" +
    "   テクニカルスクール甘木 サイトのコンテンツ（文字情報）\n" +
    "   index.html / diary.html が共通で読み込みます。\n\n" +
    "   ★このファイルはサイト右上の「管理者」から編集・保存できます。\n" +
    "   　手動で書き換える場合は、ダブルクォート \" や カンマ , の\n" +
    "   　対応を崩さないよう注意してください（JSON形式です）。\n" +
    "   ========================================================= */\n\n";

  var HEADER_DIARY = "/* =========================================================\n" +
    "   テクニカルスクール甘木 「コーチの独り言」本文データ（会員限定）\n\n" +
    "   ★このファイルは通常のページ読み込みでは読み込まれません。\n" +
    "   　合言葉が正しく入力されたときだけ、diary-gate.js が\n" +
    "   　このファイルを取得して表示します。\n\n" +
    "   ★このファイルはサイトの「独り言」管理者モードから編集・保存できます。\n" +
    "   　手動で書き換える場合は、ダブルクォート \" や カンマ , の\n" +
    "   　対応を崩さないよう注意してください（JSON形式です）。\n" +
    "   ========================================================= */\n\n";

  var HEADER_MANGA = "/* =========================================================\n" +
    "   テクニカルスクール甘木 「サッカー4コマ漫画」データ（公開）\n\n" +
    "   ★このファイルはトップページの4コマモーダルと、\n" +
    "   　バックナンバーページ（manga.html）から読み込まれます。\n" +
    "   　合言葉は不要で、誰でも見られる公開コンテンツです。\n\n" +
    "   ★このファイルはサイトの「4コマ漫画」管理者モードから編集・保存できます。\n" +
    "   　手動で書き換える場合は、ダブルクォート \" や カンマ , の\n" +
    "   　対応を崩さないよう注意してください（JSON形式です）。\n" +
    "   ========================================================= */\n\n";

  var data = null;
  var currentSha = null;
  var currentDiarySha = null;
  var currentMangaSha = null;
  var scrollTargetId = null;

  function apiUrl(path) {
    return "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + (path || GITHUB_PATH) + "?ref=" + GITHUB_BRANCH;
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
    buildLineModal();
    if (navLink) navLink.addEventListener("click", function (e) { e.preventDefault(); handleTrigger(null); });
    if (diaryLink) diaryLink.addEventListener("click", function (e) { e.preventDefault(); handleTrigger("diary"); });
  }

  function isAdminAuthValid() {
    var until = parseInt(localStorage.getItem(AUTH_KEY), 10);
    return !!until && Date.now() < until;
  }

  function setAdminAuthValid() {
    localStorage.setItem(AUTH_KEY, String(Date.now() + AUTH_DURATION_MS));
  }

  function handleTrigger(targetId) {
    if (data) {
      if (targetId) scrollToTarget(targetId); // 既に編集モード中はスクロールだけ行う
      return;
    }
    scrollTargetId = targetId;
    if (isAdminAuthValid()) {
      startAuthedFlow();
    } else {
      openLoginModal();
    }
  }

  function startAuthedFlow() {
    modalEl.style.display = "flex";
    pwStep.style.display = "none";
    tokenStep.style.display = "none";
    modalErr.textContent = "";
    modalNote.textContent = "読み込み中...";
    submitBtn.disabled = true;
    var savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      loadFromGitHub(savedToken);
    } else {
      showTokenStep();
      modalNote.textContent = "";
      submitBtn.disabled = false;
    }
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
      setAdminAuthValid();
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

      var diaryRes = await fetch(apiUrl(GITHUB_PATH_DIARY), {
        headers: {
          "Authorization": "token " + token,
          "Accept": "application/vnd.github+json"
        }
      });
      if (diaryRes.status === 404) {
        currentDiarySha = null;
        data.diary = {
          latest: { title: "", date: "", topicHeading: "高校サッカー・W杯の話題", topicText: "", analysisHeading: "チームの試合分析", analysisText: "", players: [] },
          archive: []
        };
      } else if (diaryRes.ok) {
        var diaryJson = await diaryRes.json();
        currentDiarySha = diaryJson.sha;
        var diaryText = b64ToUtf8(diaryJson.content);
        var diaryMatch = diaryText.match(/window\.DIARY_CONTENT\s*=\s*([\s\S]*?);\s*$/);
        if (!diaryMatch) throw new Error("diary-data.js の中身を読み取れませんでした。");
        data.diary = JSON.parse(diaryMatch[1]);
      } else {
        throw new Error("diary-data.js の読み込みに失敗しました（エラー" + diaryRes.status + "）");
      }

      var mangaRes = await fetch(apiUrl(GITHUB_PATH_MANGA), {
        headers: {
          "Authorization": "token " + token,
          "Accept": "application/vnd.github+json"
        }
      });
      if (mangaRes.status === 404) {
        currentMangaSha = null;
        data.manga = {
          series: { latest: { number: 1, date: "", title: "", image: "", imageUpdatedAt: "" }, archive: [] }
        };
      } else if (mangaRes.ok) {
        var mangaJson = await mangaRes.json();
        currentMangaSha = mangaJson.sha;
        var mangaText = b64ToUtf8(mangaJson.content);
        var mangaMatch = mangaText.match(/window\.MANGA_CONTENT\s*=\s*([\s\S]*?);\s*$/);
        if (!mangaMatch) throw new Error("manga-data.js の中身を読み取れませんでした。");
        data.manga = JSON.parse(mangaMatch[1]);
      } else {
        throw new Error("manga-data.js の読み込みに失敗しました（エラー" + mangaRes.status + "）");
      }

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
  var barEl, barMsg, barStats;

  function buildBar() {
    barEl = document.createElement("div");
    barEl.id = "admin-bar";
    barEl.style.display = "none";
    barEl.innerHTML =
      '<span class="admin-bar-label">🔓 編集モード</span>' +
      '<span class="admin-bar-stats"></span>' +
      '<span class="admin-bar-msg"></span>' +
      '<button type="button" class="admin-bar-btn" id="admin-line-btn">📣 LINE配信</button>' +
      '<button type="button" class="admin-bar-btn primary">💾 保存する</button>' +
      '<button type="button" class="admin-bar-btn">終了する</button>';
    document.body.appendChild(barEl);
    barMsg = barEl.querySelector(".admin-bar-msg");
    barStats = barEl.querySelector(".admin-bar-stats");
    barEl.querySelector("#admin-line-btn").addEventListener("click", openLineModal);
    var btns = barEl.querySelectorAll(".admin-bar-btn:not(#admin-line-btn)");
    btns[0].addEventListener("click", saveToGitHub);
    btns[1].addEventListener("click", exitAdmin);
  }

  /* ===== LINE配信（内容を作って、自分のスマホのLINEで送る） ===== */
  var LINE_DRAFT_KEY = "amagi-line-draft";
  var lineModalEl, lineDateEl, lineDiaryRow, lineDiaryEl, lineBodyInput, linePreviewEl, lineSendLink;

  function computeNextTuesday() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = (2 - today.getDay() + 7) % 7; // 2 = 火曜日。今日が火曜なら0（今日）
    var target = new Date(today.getTime() + diff * 24 * 60 * 60 * 1000);
    return (target.getMonth() + 1) + "月" + target.getDate() + "日（火）";
  }

  function latestDiaryLine() {
    var latest = data && data.diary && data.diary.latest;
    if (!latest) return "";
    var numMatch = (latest.title || "").match(/(\d+)/);
    var num = numMatch ? numMatch[1] : "";
    var topic = (latest.topicHeading || "").trim();
    if (!num && !topic) return "";
    var line = "📖 ";
    if (num) line += "第" + num + "回独り言";
    if (topic) line += (num ? "の" : "") + "「" + topic + "」";
    line += "を更新しました";
    return line;
  }

  function buildLineMessage() {
    var dateLabel = lineDateEl ? lineDateEl.textContent : computeNextTuesday();
    var body = lineBodyInput ? lineBodyInput.value.trim() : "";
    var text = SITE_URL + "\n\n";
    text += "📣 テクニカルスクールのご案内\n\n次回の練習日：" + dateLabel;
    var diaryLine = latestDiaryLine();
    if (diaryLine) text += "\n" + diaryLine;
    text += "\n\n更に毎週2回から3回\nテクニカル漫画「チロんぽ、メロんぽ」🐶更新しています。";
    if (body) text += "\n\n" + body;
    return text;
  }

  function updateLinePreview() {
    var text = buildLineMessage();
    if (linePreviewEl) linePreviewEl.textContent = text;
    if (lineSendLink) lineSendLink.href = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
    if (lineBodyInput) localStorage.setItem(LINE_DRAFT_KEY, lineBodyInput.value);
  }

  function buildLineModal() {
    lineModalEl = document.createElement("div");
    lineModalEl.className = "admin-modal-overlay";
    lineModalEl.style.display = "none";
    lineModalEl.innerHTML =
      '<div class="admin-modal-box">' +
      '  <div class="admin-modal-title">📣 LINE配信の内容を作る</div>' +
      '  <p class="admin-modal-desc">次回の練習日は自動で入ります。下に今週のお知らせがあれば書き足してください。</p>' +
      '  <p class="admin-modal-desc"><strong>次回の練習日：<span id="line-date"></span></strong></p>' +
      '  <p class="admin-modal-desc" id="line-diary-row" hidden><strong id="line-diary"></strong></p>' +
      '  <textarea id="line-body-input" rows="4" placeholder="（任意）今週のお知らせがあれば入力してください" style="width:100%;box-sizing:border-box;"></textarea>' +
      '  <p class="admin-modal-desc">プレビュー：</p>' +
      '  <pre id="line-preview" class="line-preview-box"></pre>' +
      '  <div class="admin-modal-err"></div>' +
      '  <div class="admin-modal-actions">' +
      '    <button type="button" class="admin-modal-btn ghost" id="line-close-btn">閉じる</button>' +
      '    <a href="#" target="_blank" rel="noopener" class="admin-modal-btn primary" id="line-send-link">LINEで送る</a>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(lineModalEl);

    lineDateEl = lineModalEl.querySelector("#line-date");
    lineDiaryRow = lineModalEl.querySelector("#line-diary-row");
    lineDiaryEl = lineModalEl.querySelector("#line-diary");
    lineBodyInput = lineModalEl.querySelector("#line-body-input");
    linePreviewEl = lineModalEl.querySelector("#line-preview");
    lineSendLink = lineModalEl.querySelector("#line-send-link");

    lineBodyInput.addEventListener("input", updateLinePreview);
    lineModalEl.querySelector("#line-close-btn").addEventListener("click", closeLineModal);
    lineModalEl.addEventListener("click", function (e) { if (e.target === lineModalEl) closeLineModal(); });
  }

  function openLineModal() {
    lineDateEl.textContent = computeNextTuesday();
    var diaryLine = latestDiaryLine();
    if (diaryLine) {
      lineDiaryEl.textContent = diaryLine;
      lineDiaryRow.hidden = false;
    } else {
      lineDiaryRow.hidden = true;
    }
    lineBodyInput.value = localStorage.getItem(LINE_DRAFT_KEY) || "";
    updateLinePreview();
    lineModalEl.style.display = "flex";
  }

  function closeLineModal() {
    lineModalEl.style.display = "none";
  }

  /* ===== 閲覧数（GoatCounter） ===== */
  function getGoatCounterToken() {
    var token = localStorage.getItem(GOATCOUNTER_TOKEN_KEY);
    if (token) return token;
    token = window.prompt("GoatCounterのAPIトークンを入力してください（閲覧数の表示に使います。この端末に保存され、次回以降は不要です）");
    if (!token) return null;
    token = token.trim();
    localStorage.setItem(GOATCOUNTER_TOKEN_KEY, token);
    return token;
  }

  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  async function fetchGoatCounterTotal(token, days) {
    var end = new Date();
    var start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    var url = "https://" + GOATCOUNTER_SITE + ".goatcounter.com/api/v0/stats/total?start=" + fmtDate(start) + "&end=" + fmtDate(end);
    var res = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(GOATCOUNTER_TOKEN_KEY);
      throw new Error("トークンが無効です");
    }
    if (!res.ok) throw new Error("エラー" + res.status);
    var json = await res.json();
    return json;
  }

  async function loadMangaOpenCounter(el) {
    var token = getGoatCounterToken();
    if (!token) {
      el.textContent = "";
      return;
    }
    el.className = "manga-view-counter";
    el.textContent = "🐾 漫画が開かれた回数を取得中...";
    try {
      var week = await fetchGoatCounterTotal(token, 7);
      var month = await fetchGoatCounterTotal(token, 30);
      el.textContent = "🐾 漫画が開かれた回数：今週 " + week.total_events + "回／今月 " + month.total_events + "回";
    } catch (e) {
      el.textContent = "🐾 漫画の閲覧数を取得できませんでした（" + e.message + "）";
    }
  }
  window.__loadMangaOpenCounter = loadMangaOpenCounter;

  async function loadViewStats() {
    if (!barStats) return;
    var token = getGoatCounterToken();
    if (!token) {
      barStats.textContent = "";
      return;
    }
    barStats.textContent = "📊 閲覧数を取得中...";
    try {
      var week = await fetchGoatCounterTotal(token, 7);
      var month = await fetchGoatCounterTotal(token, 30);
      barStats.textContent = "📊 今週の閲覧数: " + week.total + "回／今月の閲覧数: " + month.total + "回";
    } catch (e) {
      barStats.textContent = "📊 閲覧数を取得できませんでした（" + e.message + "）";
    }
  }

  function rerenderAdmin() {
    window.renderSite(data, { editable: true, onChange: rerenderAdmin });
  }

  function enterAdminMode() {
    document.body.classList.add("admin-mode-on");
    rerenderAdmin();
    barEl.style.display = "flex";
    barMsg.textContent = "編集して「保存する」を押してください。";
    loadViewStats();
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
      if (pendingUploads && pendingUploads.mangaLatest_series) {
        barMsg.textContent = "4コマ漫画をアップロード中...";
        var mangaEpNumber = (data.manga && data.manga.series && data.manga.series.latest && data.manga.series.latest.number) || 1;
        var mangaImagePath = "manga/episode" + mangaEpNumber + "-" + Date.now() + ".jpg";
        await uploadBinaryFile(mangaImagePath, pendingUploads.mangaLatest_series, token);
        data.manga.series.latest.image = mangaImagePath;
        data.manga.series.latest.imageUpdatedAt = String(Date.now());
        pendingUploads.mangaLatest_series = null;
        barMsg.textContent = "保存中...";
      }

      var contentOnly = {};
      for (var k in data) { if (k !== "diary" && k !== "manga") contentOnly[k] = data[k]; }
      var json = JSON.stringify(contentOnly, null, 2);
      var output = HEADER + "window.SITE_CONTENT = " + json + ";\n";
      var res = await fetch(apiUrl(GITHUB_PATH).split("?")[0], {
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

      if (data.diary) {
        barMsg.textContent = "独り言を保存中...";
        var diaryOutput = HEADER_DIARY + "window.DIARY_CONTENT = " + JSON.stringify(data.diary, null, 2) + ";\n";
        var diaryBody = {
          message: "独り言を更新（管理者モード） " + new Date().toLocaleString("ja-JP"),
          content: utf8ToB64(diaryOutput),
          branch: GITHUB_BRANCH
        };
        if (currentDiarySha) diaryBody.sha = currentDiarySha;
        var diaryRes = await fetch(apiUrl(GITHUB_PATH_DIARY).split("?")[0], {
          method: "PUT",
          headers: {
            "Authorization": "token " + token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(diaryBody)
        });
        if (!diaryRes.ok) {
          var diaryErrJson = await diaryRes.json().catch(function () { return {}; });
          throw new Error("独り言の保存に失敗しました（エラー" + diaryRes.status + "）：" + (diaryErrJson.message || ""));
        }
        var diaryResJson = await diaryRes.json();
        currentDiarySha = diaryResJson.content.sha;
      }

      if (data.manga) {
        barMsg.textContent = "4コマ漫画データを保存中...";
        var mangaOutput = HEADER_MANGA + "window.MANGA_CONTENT = " + JSON.stringify(data.manga, null, 2) + ";\n";
        var mangaBody = {
          message: "4コマ漫画を更新（管理者モード） " + new Date().toLocaleString("ja-JP"),
          content: utf8ToB64(mangaOutput),
          branch: GITHUB_BRANCH
        };
        if (currentMangaSha) mangaBody.sha = currentMangaSha;
        var mangaSaveRes = await fetch(apiUrl(GITHUB_PATH_MANGA).split("?")[0], {
          method: "PUT",
          headers: {
            "Authorization": "token " + token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(mangaBody)
        });
        if (!mangaSaveRes.ok) {
          var mangaErrJson = await mangaSaveRes.json().catch(function () { return {}; });
          throw new Error("4コマ漫画の保存に失敗しました（エラー" + mangaSaveRes.status + "）：" + (mangaErrJson.message || ""));
        }
        var mangaSaveJson = await mangaSaveRes.json();
        currentMangaSha = mangaSaveJson.content.sha;
      }

      barMsg.textContent = "✅ GitHubに保存しました（" + new Date().toLocaleTimeString("ja-JP") + "）。1分ほどでサイトに反映されます。";
    } catch (err) {
      barMsg.textContent = (err && err.message) ? err.message : String(err);
    }
  }

  function exitAdmin() {
    location.reload();
  }
})();
