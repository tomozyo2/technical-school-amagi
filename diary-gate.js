/* =========================================================
   「コーチの独り言」会員限定ゲート
   index.html / diary.html の両方から読み込まれます。

   ・合言葉を変更したい場合は、下の MEMBER_PASSWORD を書き換えてください。
   ・本文（diary-data.js）は、合言葉が正しく入力されるまで
     読み込まれません（ページのソースにも表示されません）。
   ・一度合言葉を入力したブラウザは、次回以降は自動で表示されます。
   ========================================================= */

(function () {
  "use strict";

  var MEMBER_PASSWORD = "1112";
  var STORAGE_KEY = "amagi-diary-unlocked";

  var GATES = [
    { gateId: "diary-gate", formId: "diary-gate-form", inputId: "diary-gate-input", errId: "diary-gate-err", wrapId: "diary-content-wrap" },
    { gateId: "diary-archive-gate", formId: "diary-archive-gate-form", inputId: "diary-archive-gate-input", errId: "diary-archive-gate-err", wrapId: "archive-list" }
  ];

  function byId(id) { return document.getElementById(id); }

  function loadDiaryData(cb) {
    if (window.DIARY_CONTENT) { cb(window.DIARY_CONTENT); return; }
    var script = document.createElement("script");
    script.src = "diary-data.js?v=" + Date.now();
    script.onload = function () { cb(window.DIARY_CONTENT || null); };
    script.onerror = function () { cb(null); };
    document.head.appendChild(script);
  }

  function reveal(cfg) {
    var gateEl = byId(cfg.gateId);
    var wrapEl = byId(cfg.wrapId);
    if (gateEl) gateEl.hidden = true;
    if (wrapEl) wrapEl.hidden = false;
  }

  function unlockAll() {
    loadDiaryData(function (diary) {
      if (diary) {
        window.SITE_CONTENT = window.SITE_CONTENT || {};
        window.SITE_CONTENT.diary = diary;
        if (window.renderSite) window.renderSite(window.SITE_CONTENT, { editable: false });
      }
      GATES.forEach(function (cfg) {
        if (byId(cfg.gateId)) reveal(cfg);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var alreadyUnlocked = localStorage.getItem(STORAGE_KEY) === "1";
    if (alreadyUnlocked) unlockAll();

    GATES.forEach(function (cfg) {
      var form = byId(cfg.formId);
      if (!form) return;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = byId(cfg.inputId);
        var errEl = byId(cfg.errId);
        var value = input ? input.value : "";
        if (value === MEMBER_PASSWORD) {
          if (errEl) errEl.textContent = "";
          localStorage.setItem(STORAGE_KEY, "1");
          unlockAll();
        } else {
          if (errEl) errEl.textContent = "合言葉が違います";
        }
      });
    });
  });
})();
