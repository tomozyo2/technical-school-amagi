/* =========================================================
   管理者モード（その場編集・GitHubに直接保存）
   index.html / diary.html の両方から読み込まれます。

   ・入るには「合言葉」が必要です（初回のみ入力し、以降はこの端末に保存されます）。
   　合言葉とGitHubの鍵は「中継所」(Cloudflare Worker)が預かっています。
   　合言葉を変えたい場合は、Cloudflareの秘密の設定 ADMIN_PASSPHRASE を変えてください。
   ・リポジトリ名などを変更した場合は、下の GITHUB_* と、中継所の worker.js を書き換えてください。
   ・「保存する」を押すと、ここで設定したGitHubリポジトリの content.js に
   　中継所を通して直接コミットされます（GitHub Desktopでのcommit/pushは不要になります）。
   ========================================================= */

(function () {
  "use strict";

  // 中継所のURL（末尾に / を付けない）
  var RELAY_URL = "https://amagi-admin-relay.amagifc.workers.dev";

  var GITHUB_OWNER = "tomozyo2";
  var GITHUB_REPO = "technical-school-amagi";
  var GITHUB_BRANCH = "main";
  var GITHUB_PATH = "content.js";
  var GITHUB_PATH_DIARY = "diary-data.js";
  var GITHUB_PATH_MANGA = "manga-data.js";
  var SITE_URL = "https://" + GITHUB_OWNER + ".github.io/" + GITHUB_REPO + "/";
  var TOKEN_KEY = "amagi-passphrase"; // 端末に保存する「合言葉」
  var AUTH_KEY = "amagi-admin-auth-until";
  var AUTH_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 合言葉の入力を省略できる期間（30日）

  // 以前の方式で端末に保存していた鍵（GitHub・GoatCounter）。もう使わないので消す
  try {
    localStorage.removeItem("amagi-gh-pat");
    localStorage.removeItem("amagi-gc-token");
  } catch (e) { /* 保存領域が使えない場合は何もしない */ }

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
    return contentsUrl(path || GITHUB_PATH) + "?ref=" + GITHUB_BRANCH;
  }

  // GitHubへの窓口（中継所経由）
  function contentsUrl(path) {
    return RELAY_URL + "/gh/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path;
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
    modalErr.textContent = "";
    modalNote.textContent = "読み込み中...";
    submitBtn.disabled = true;
    var savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      loadFromGitHub(savedToken, false);
    } else {
      openLoginModal();
    }
  }

  function scrollToTarget(id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ===== 合言葉入力モーダル ===== */
  var modalEl, pwStep, pwInput, modalErr, submitBtn, modalNote, modalTitle;

  function buildModal() {
    modalEl = document.createElement("div");
    modalEl.className = "admin-modal-overlay";
    modalEl.style.display = "none";
    modalEl.innerHTML =
      '<div class="admin-modal-box">' +
      '  <div class="admin-modal-title">⚽ 管理者モード</div>' +
      '  <div id="pw-step">' +
      '    <p class="admin-modal-desc">合言葉を入力してください。<br>この端末に保存され、次回以降は不要です。</p>' +
      '    <input type="password" id="pw-input" autocomplete="off" placeholder="合言葉">' +
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
    modalErr = modalEl.querySelector(".admin-modal-err");
    modalNote = modalEl.querySelector(".admin-modal-note");
    var btns = modalEl.querySelectorAll(".admin-modal-btn");
    var cancelBtn = btns[0];
    submitBtn = btns[1];

    cancelBtn.addEventListener("click", closeLoginModal);
    submitBtn.addEventListener("click", submitStep);
    pwInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitStep(); });
  }

  function openLoginModal() {
    pwStep.style.display = "block";
    pwInput.value = "";
    modalErr.textContent = "";
    modalNote.textContent = "";
    submitBtn.disabled = false;
    modalEl.style.display = "flex";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { pwInput.focus(); });
    });
  }

  function closeLoginModal() {
    modalEl.style.display = "none";
  }

  function submitStep() {
    var passphrase = pwInput.value.trim();
    if (!passphrase) {
      modalErr.textContent = "合言葉を入力してください";
      return;
    }
    loadFromGitHub(passphrase, true);
  }

  // token = 合言葉。中継所が合言葉を確かめ、GitHubの鍵を付けて代わりにGitHubへ問い合わせる。
  // isNewLogin: 入力したばかりの合言葉なら true（正しいと分かってから端末に保存する）
  async function loadFromGitHub(token, isNewLogin) {
    modalErr.textContent = "";
    modalNote.textContent = "読み込み中...";
    submitBtn.disabled = true;
    try {
      var res = await fetch(apiUrl(), {
        headers: {
          "X-Passphrase": token,
          "Accept": "application/vnd.github+json"
        }
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(AUTH_KEY);
        openLoginModal();
        modalErr.textContent = "合言葉が違います。もう一度入力してください。";
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
          "X-Passphrase": token,
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
          "X-Passphrase": token,
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

      if (isNewLogin) {
        localStorage.setItem(TOKEN_KEY, token);
        setAdminAuthValid();
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
  var barEl, barMsg, statsEl;

  // 閲覧数カード（編集モードのとき、ページの一番上・ヘッダーのすぐ下に出す）
  function buildStatsCard() {
    statsEl = document.createElement("div");
    statsEl.id = "admin-stats";
    statsEl.style.display = "none";
    statsEl.innerHTML =
      '<div class="admin-stats-title">📊 サイトの閲覧数</div>' +
      '<div class="admin-stats-grid">' +
      '  <div class="admin-stats-item"><div class="admin-stats-num" data-k="day">-</div><div class="admin-stats-label">今日</div></div>' +
      '  <div class="admin-stats-item"><div class="admin-stats-num" data-k="week">-</div><div class="admin-stats-label">週（直近7日）</div></div>' +
      '  <div class="admin-stats-item"><div class="admin-stats-num" data-k="month">-</div><div class="admin-stats-label">月（直近30日）</div></div>' +
      '  <div class="admin-stats-item"><div class="admin-stats-num" data-k="all">-</div><div class="admin-stats-label">合計</div></div>' +
      '</div>' +
      '<div class="admin-stats-note"></div>';
    var header = document.querySelector("header.site-header");
    if (header && header.parentNode) {
      header.parentNode.insertBefore(statsEl, header.nextSibling);
    } else {
      document.body.insertBefore(statsEl, document.body.firstChild);
    }
  }

  function buildBar() {
    buildStatsCard();
    barEl = document.createElement("div");
    barEl.id = "admin-bar";
    barEl.style.display = "none";
    barEl.innerHTML =
      '<span class="admin-bar-label">🔓 編集モード</span>' +
      '<span class="admin-bar-msg"></span>' +
      '<button type="button" class="admin-bar-btn" id="admin-line-btn">📣 LINE配信</button>' +
      '<button type="button" class="admin-bar-btn primary">💾 保存する</button>' +
      '<button type="button" class="admin-bar-btn">終了する</button>';
    document.body.appendChild(barEl);
    barMsg = barEl.querySelector(".admin-bar-msg");
    barEl.querySelector("#admin-line-btn").addEventListener("click", openLineModal);
    var btns = barEl.querySelectorAll(".admin-bar-btn:not(#admin-line-btn)");
    btns[0].addEventListener("click", saveToGitHub);
    btns[1].addEventListener("click", exitAdmin);
  }

  /* ===== LINE配信（内容を作って、自分のスマホのLINEでグループに送る） ===== */
  var LINE_DRAFT_KEY = "amagi-line-draft";
  var lineModalEl, lineBodyInput, linePreviewEl, lineSendLink;

  // LINEの「決まった文章」。画面から書き換えられ、data.lineTemplate に保存される（未設定なら下の初期文）
  var LINE_TEMPLATE_FIELDS = [
    { key: "title", label: "いちばん上の見出し", def: "📣 テクニカルスクールのご案内" },
    { key: "siteLabel", label: "ホームページの案内文", def: "🏠 ホームページ" },
    { key: "mangaLabel", label: "漫画の案内文", def: "📖 チロんぽ＆メロんぽ漫画（週2回更新）" },
    { key: "nextLabel", label: "次回の練習日の前の文", def: "⚽ 次回のトレーニング：" },
    { key: "placeLabel", label: "場所の前の文", def: "📍 場所：" },
    { key: "timeLabel", label: "時間の前の文", def: "🕐 時間：" },
    { key: "placeValue", label: "場所そのもの（空欄ならホームページの場所）", def: "", ph: "place" },
    { key: "timeValue", label: "時間そのもの（空欄ならホームページの時間）", def: "", ph: "time" },
    { key: "menuLabel", label: "トレーニング内容の見出し", def: "📝 トレーニング内容" },
    { key: "offText", label: "お休みの日の文（{日付}に日付が入ります）", def: "🚫 {日付}は練習はお休みです。" },
    { key: "mangaNotice", label: "漫画更新のお知らせ文（漫画の下書き画面の「LINEでお知らせ」用）", def: "チロんぽ＆メロんぽ物語更新しました🐶" }
  ];

  function lineTpl(key) {
    var t = (data && data.lineTemplate) || {};
    if (Object.prototype.hasOwnProperty.call(t, key)) return t[key];
    for (var i = 0; i < LINE_TEMPLATE_FIELDS.length; i++) {
      if (LINE_TEMPLATE_FIELDS[i].key === key) return LINE_TEMPLATE_FIELDS[i].def;
    }
    return "";
  }

  // 次の練習日（今日が練習日なら今日）。お休みの日なら isOff: true
  function nextPracticeInfo() {
    var weekday = (data && data.schedule && data.schedule.weekday != null) ? data.schedule.weekday : 2;
    var offDates = (data && data.schedule && data.schedule.offDates) || [];
    var names = ["日", "月", "火", "水", "木", "金", "土"];
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = (weekday - today.getDay() + 7) % 7;
    var target = new Date(today.getTime() + diff * 24 * 60 * 60 * 1000);
    var key = (target.getMonth() + 1) + "/" + target.getDate();
    return {
      label: (target.getMonth() + 1) + "月" + target.getDate() + "日（" + names[weekday] + "）",
      isOff: offDates.indexOf(key) !== -1
    };
  }

  // ホームページに載っている「練習メニュー」（日付と内容）
  function trainingMenuInfo() {
    var items = (data && data.training && data.training.items) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var isMenu = it.kind ? it.kind === "menu" : (it.title || "").indexOf("メニュー") !== -1;
      if (!isMenu) continue;
      var date = it.date != null ? it.date : (it.icon || "").replace(/^⚽\s*/, "");
      var lines = String(it.text || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      return { date: date, lines: lines };
    }
    return null;
  }

  function buildLineMessage() {
    var body = lineBodyInput ? lineBodyInput.value.trim() : "";
    var info = (data && data.info) || {};
    var next = nextPracticeInfo();
    var text = lineTpl("title") + "\n\n";
    text += lineTpl("siteLabel") + "\n" + SITE_URL + "\n\n";
    text += lineTpl("mangaLabel") + "\n" + SITE_URL + "manga.html\n\n";
    if (next.isOff) {
      text += lineTpl("offText").split("{日付}").join(next.label);
    } else {
      text += lineTpl("nextLabel") + next.label + "\n";
      text += lineTpl("placeLabel") + (lineTpl("placeValue") || info.place || "丸山公園多目的広場") + "\n";
      text += lineTpl("timeLabel") + (lineTpl("timeValue") || info.time || "17:45〜19:30");
      var menu = trainingMenuInfo();
      if (menu && menu.lines.length) {
        text += "\n\n" + lineTpl("menuLabel") + (menu.date ? "（" + menu.date + "）" : "") + "\n";
        text += menu.lines.map(function (l, i) { return (i + 1) + ". " + l; }).join("\n");
      }
    }
    if (body) text += "\n\n" + body;
    return text;
  }

  function updateLinePreview() {
    var text = buildLineMessage();
    if (linePreviewEl) linePreviewEl.textContent = text;
    if (lineSendLink) lineSendLink.href = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
    if (lineBodyInput) localStorage.setItem(LINE_DRAFT_KEY, lineBodyInput.value);
    var offNote = lineModalEl && lineModalEl.querySelector("#line-off-note");
    if (offNote) {
      var n = nextPracticeInfo();
      offNote.textContent = n.isOff ? "※ " + n.label + "は「お休み」に設定されているため、場所・時間・トレーニング内容は表示されません。" : "";
      offNote.style.display = n.isOff ? "" : "none";
    }
  }

  function buildLineModal() {
    lineModalEl = document.createElement("div");
    lineModalEl.className = "admin-modal-overlay";
    lineModalEl.style.display = "none";
    lineModalEl.innerHTML =
      '<div class="admin-modal-box" style="max-width:440px;">' +
      '  <div class="admin-modal-title">📣 LINE配信の内容を作る</div>' +
      '  <p class="admin-modal-desc">ホームページ・漫画のアドレス、次回の練習日（お休みならお休み）、場所・時間、トレーニング内容は自動で入ります。下に自由に書き足せます。</p>' +
      '  <textarea id="line-body-input" rows="4" placeholder="（任意）自由に書けるスペース" style="width:100%;box-sizing:border-box;"></textarea>' +
      '  <details class="line-tpl-edit">' +
      '    <summary>✏ 決まった文章を編集する</summary>' +
      '    <p class="line-tpl-note">書き換えるとプレビューにすぐ反映され、自動で保存されます（次回以降・他の端末でも同じ文章になります）。</p>' +
      '    <p class="line-tpl-note" id="line-tpl-status"></p>' +
      LINE_TEMPLATE_FIELDS.map(function (f) {
        return '<label class="line-tpl-label">' + f.label + '<input type="text" data-tpl-key="' + f.key + '"></label>';
      }).join("") +
      '    <button type="button" class="admin-modal-btn ghost" id="line-tpl-reset" style="margin-top:10px;">初期の文章に戻す</button>' +
      '  </details>' +
      '  <p class="admin-modal-desc">送信する内容（プレビュー）：</p>' +
      '  <p class="line-tpl-note" id="line-off-note" style="display:none;color:#c0392b;"></p>' +
      '  <pre id="line-preview" class="line-preview-box"></pre>' +
      '  <div class="admin-modal-err"></div>' +
      '  <div class="admin-modal-actions">' +
      '    <button type="button" class="admin-modal-btn ghost" id="line-close-btn">閉じる</button>' +
      '    <a href="#" target="_blank" rel="noopener" class="admin-modal-btn primary" id="line-send-link">LINEで送る</a>' +
      '  </div>' +
      '  <p class="admin-modal-desc" style="margin:12px 0 0;">「LINEで送る」を押すとLINEが開くので、グループを選んで送信してください。</p>' +
      '</div>';
    document.body.appendChild(lineModalEl);

    lineBodyInput = lineModalEl.querySelector("#line-body-input");
    linePreviewEl = lineModalEl.querySelector("#line-preview");
    lineSendLink = lineModalEl.querySelector("#line-send-link");

    lineBodyInput.addEventListener("input", updateLinePreview);
    lineModalEl.querySelectorAll("[data-tpl-key]").forEach(function (input) {
      input.addEventListener("input", function () {
        if (!data) return;
        data.lineTemplate = data.lineTemplate || {};
        data.lineTemplate[input.getAttribute("data-tpl-key")] = input.value;
        updateLinePreview();
        scheduleLineTemplateSave();
      });
    });
    lineModalEl.querySelector("#line-tpl-reset").addEventListener("click", function () {
      if (!data) return;
      delete data.lineTemplate;
      fillLineTemplateInputs();
      updateLinePreview();
      scheduleLineTemplateSave();
    });
    lineModalEl.querySelector("#line-close-btn").addEventListener("click", closeLineModal);
    lineModalEl.addEventListener("click", function (e) { if (e.target === lineModalEl) closeLineModal(); });
  }

  // LINEの文章だけを、content.js に自動保存する（他の編集途中の内容は保存しない）
  var lineTplTimer = null;
  function setLineTplStatus(msg) {
    var el = lineModalEl && lineModalEl.querySelector("#line-tpl-status");
    if (el) el.textContent = msg;
  }
  function scheduleLineTemplateSave() {
    setLineTplStatus("保存待ち...");
    clearTimeout(lineTplTimer);
    lineTplTimer = setTimeout(saveLineTemplate, 1200);
  }
  async function saveLineTemplate() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLineTplStatus("⚠ 合言葉が見つからず保存できませんでした"); return; }
    setLineTplStatus("保存中...");
    try {
      var url = apiUrl(GITHUB_PATH).split("?")[0];
      var headers = { "X-Passphrase": token, "Accept": "application/vnd.github+json" };
      var getRes = await fetch(url + "?ref=" + GITHUB_BRANCH, { cache: "no-store", headers: headers });
      if (!getRes.ok) throw new Error("読み込みに失敗（エラー" + getRes.status + "）");
      var getJson = await getRes.json();
      var match = b64ToUtf8(getJson.content).match(/window\.SITE_CONTENT\s*=\s*([\s\S]*?);\s*$/);
      if (!match) throw new Error("content.js を読み取れませんでした");
      var remote = JSON.parse(match[1]);
      if (data.lineTemplate) remote.lineTemplate = data.lineTemplate; else delete remote.lineTemplate;
      var output = HEADER + "window.SITE_CONTENT = " + JSON.stringify(remote, null, 2) + ";\n";
      var putRes = await fetch(url, {
        method: "PUT",
        headers: { "X-Passphrase": token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "LINE配信の文章を更新（管理者モード） " + new Date().toLocaleString("ja-JP"),
          content: utf8ToB64(output),
          sha: getJson.sha,
          branch: GITHUB_BRANCH
        })
      });
      if (!putRes.ok) throw new Error("保存に失敗（エラー" + putRes.status + "）");
      currentSha = (await putRes.json()).content.sha;
      setLineTplStatus("✅ 保存しました（" + new Date().toLocaleTimeString("ja-JP") + "）");
    } catch (err) {
      setLineTplStatus("⚠ " + ((err && err.message) ? err.message : err));
    }
  }

  function fillLineTemplateInputs() {
    lineModalEl.querySelectorAll("[data-tpl-key]").forEach(function (input) {
      var key = input.getAttribute("data-tpl-key");
      input.value = lineTpl(key);
      if (key === "placeValue") input.placeholder = (data && data.info && data.info.place) || "丸山公園多目的広場";
      if (key === "timeValue") input.placeholder = (data && data.info && data.info.time) || "17:45〜19:30";
    });
  }

  function openLineModal() {
    fillLineTemplateInputs();
    lineBodyInput.value = localStorage.getItem(LINE_DRAFT_KEY) || "";
    updateLinePreview();
    lineModalEl.style.display = "flex";
  }

  function closeLineModal() {
    lineModalEl.style.display = "none";
  }

  /* ===== 漫画更新のLINEお知らせ（管理者の漫画・下書き画面から） ===== */
  var mangaLineModalEl, mangaLinePreviewEl, mangaLineSendLink;

  function buildMangaLineModal() {
    mangaLineModalEl = document.createElement("div");
    mangaLineModalEl.className = "admin-modal-overlay";
    mangaLineModalEl.style.display = "none";
    mangaLineModalEl.innerHTML =
      '<div class="admin-modal-box">' +
      '  <div class="admin-modal-title">📣 漫画更新をLINEでお知らせ</div>' +
      '  <p class="admin-modal-desc">内容を確認してから送信してください。</p>' +
      '  <pre id="manga-line-preview" class="line-preview-box"></pre>' +
      '  <div class="admin-modal-actions">' +
      '    <button type="button" class="admin-modal-btn ghost" id="manga-line-close-btn">閉じる</button>' +
      '    <a href="#" target="_blank" rel="noopener" class="admin-modal-btn primary" id="manga-line-send-link">LINEで送る</a>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(mangaLineModalEl);

    mangaLinePreviewEl = mangaLineModalEl.querySelector("#manga-line-preview");
    mangaLineSendLink = mangaLineModalEl.querySelector("#manga-line-send-link");
    mangaLineModalEl.querySelector("#manga-line-close-btn").addEventListener("click", closeMangaLineModal);
    mangaLineModalEl.addEventListener("click", function (e) { if (e.target === mangaLineModalEl) closeMangaLineModal(); });
  }

  function openMangaLineModal() {
    var text = SITE_URL + "\n\n" + lineTpl("mangaNotice");
    mangaLinePreviewEl.textContent = text;
    mangaLineSendLink.href = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
    mangaLineModalEl.style.display = "flex";
  }

  function closeMangaLineModal() {
    mangaLineModalEl.style.display = "none";
  }
  window.__openMangaLineModal = openMangaLineModal;

  /* ===== 閲覧数（GoatCounter） ===== */
  // 閲覧数も中継所経由で取得する（GoatCounterの鍵は中継所が預かっている）ので、使うのは合言葉だけ
  function getGoatCounterToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  async function fetchGoatCounterTotal(token, days) {
    var end = new Date();
    var start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return fetchGoatCounterRange(token, fmtDate(start), fmtDate(end));
  }

  // start / end は "YYYY-MM-DD"
  async function fetchGoatCounterRange(token, start, end) {
    var url = RELAY_URL + "/gc/api/v0/stats/total?start=" + start + "&end=" + end;
    var res = await fetch(url, { headers: { "X-Passphrase": token } });
    if (res.status === 401) throw new Error("合言葉が無効です");
    if (res.status === 503) throw new Error("中継所に閲覧数の鍵が入っていません");
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

  // 端末の日付（日本時間）で "YYYY-MM-DD" にする
  function localDateStr(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  async function loadViewStats() {
    if (!statsEl) return;
    var note = statsEl.querySelector(".admin-stats-note");
    var nums = {};
    statsEl.querySelectorAll(".admin-stats-num").forEach(function (el) { nums[el.getAttribute("data-k")] = el; });
    var token = getGoatCounterToken();
    if (!token) {
      note.textContent = "";
      return;
    }
    note.textContent = "取得中...";
    var now = new Date();
    var ago = function (n) { return localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)); };
    var today = ago(0);
    try {
      var r = await Promise.all([
        fetchGoatCounterRange(token, today, today),
        fetchGoatCounterRange(token, ago(6), today),
        fetchGoatCounterRange(token, ago(29), today),
        fetchGoatCounterRange(token, "2020-01-01", today)
      ]);
      ["day", "week", "month", "all"].forEach(function (k, i) {
        nums[k].textContent = Number(r[i].total).toLocaleString("ja-JP");
      });
      note.textContent = "ページが開かれた回数です（更新: " + now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) + "）";
    } catch (e) {
      note.textContent = "閲覧数を取得できませんでした（" + e.message + "）";
    }
  }

  function rerenderAdmin() {
    window.renderSite(data, { editable: true, onChange: rerenderAdmin });
  }

  function enterAdminMode() {
    document.body.classList.add("admin-mode-on");
    if (!lineModalEl) {
      buildLineModal();
      buildMangaLineModal();
    }
    rerenderAdmin();
    barEl.style.display = "flex";
    statsEl.style.display = "block";
    barMsg.textContent = "編集して「保存する」を押してください。";
    loadViewStats();
    if (scrollTargetId) {
      scrollToTarget(scrollTargetId);
      scrollTargetId = null;
    }
  }

  async function uploadBinaryFile(path, dataUrl, token) {
    var base64 = dataUrl.split(",")[1];
    var url = contentsUrl(path);
    var sha = null;
    var getRes = await fetch(url + "?ref=" + GITHUB_BRANCH, {
      headers: { "X-Passphrase": token, "Accept": "application/vnd.github+json" }
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
        "X-Passphrase": token,
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

  async function deleteBinaryFile(path, token) {
    var url = contentsUrl(path);
    var getRes = await fetch(url + "?ref=" + GITHUB_BRANCH, {
      cache: "no-store",
      headers: { "X-Passphrase": token, "Accept": "application/vnd.github+json" }
    });
    if (getRes.status === 404) return; // 既に無い場合は何もしない
    if (!getRes.ok) throw new Error("削除対象の確認に失敗しました（エラー" + getRes.status + "）");
    var sha = (await getRes.json()).sha;
    var delRes = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-Passphrase": token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "不要になった画像を削除（管理者モード） " + new Date().toLocaleString("ja-JP"),
        sha: sha,
        branch: GITHUB_BRANCH
      })
    });
    if (delRes.status === 404) return; // 既に消えている
    if (!delRes.ok) {
      var delErrJson = await delRes.json().catch(function () { return {}; });
      throw new Error("画像の削除に失敗しました（エラー" + delRes.status + "）：" + (delErrJson.message || ""));
    }
  }

  async function saveToGitHub() {
    if (!data) return;
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      barMsg.textContent = "合言葉が見つかりません。一度「終了する」してから、もう一度お入りください。";
      return;
    }
    barMsg.textContent = "保存中...";
    try {
      var pendingDeletes = window.__adminPendingDeletes || [];
      if (pendingDeletes.length) {
        barMsg.textContent = "不要になった画像を削除中...";
        for (var di = 0; di < pendingDeletes.length; di++) {
          try {
            await deleteBinaryFile(pendingDeletes[di], token);
          } catch (delErr) {
            console.warn("画像の削除をスキップ:", pendingDeletes[di], delErr);
          }
        }
        window.__adminPendingDeletes = [];
        barMsg.textContent = "保存中...";
      }

      if (data.manga && data.manga.series) {
        var seriesData = data.manga.series;
        var pendingMangaItems = []
          .concat(seriesData.latest ? [seriesData.latest] : [])
          .concat(seriesData.archive || [])
          .concat(seriesData.queue || [])
          .filter(function (it) { return it && it._pendingImage; });
        if (pendingMangaItems.length) {
          barMsg.textContent = "4コマ漫画をアップロード中...";
          for (var pi = 0; pi < pendingMangaItems.length; pi++) {
            var pItem = pendingMangaItems[pi];
            var mangaImagePath = "manga/episode" + (pItem.number || "x") + "-" + Date.now() + "-" + pi + ".jpg";
            await uploadBinaryFile(mangaImagePath, pItem._pendingImage, token);
            pItem.image = mangaImagePath;
            pItem.imageUpdatedAt = String(Date.now());
            delete pItem._pendingImage;
          }
          barMsg.textContent = "保存中...";
        }
        (seriesData.queue || []).forEach(function (it) { delete it._checked; });
      }

      var contentOnly = {};
      for (var k in data) { if (k !== "diary" && k !== "manga") contentOnly[k] = data[k]; }
      var json = JSON.stringify(contentOnly, null, 2);
      var output = HEADER + "window.SITE_CONTENT = " + json + ";\n";
      var res = await fetch(apiUrl(GITHUB_PATH).split("?")[0], {
        method: "PUT",
        headers: {
          "X-Passphrase": token,
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
            "X-Passphrase": token,
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
            "X-Passphrase": token,
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
