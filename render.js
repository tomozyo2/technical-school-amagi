/* =========================================================
   content.js の内容をページに描画する共通スクリプト。
   index.html と diary.html の両方から読み込まれます。
   （このファイルは通常、書き換える必要はありません）

   window.renderSite(data, { editable, onChange }) を呼び出すと、
   通常表示（editable:false）または管理者の編集モード（editable:true）
   でページを描画します。編集モードでは文字が直接クリックして
   書き換えられるようになり、一覧の追加・削除ボタンも表示されます。
   ========================================================= */

(function () {

  var diaryUndoSnapshot = null; // 「バックナンバーへ移動」の直前状態（1回分だけ・保存前のみ有効）

  window.renderSite = function (data, opts) {
    opts = opts || {};
    var editable = !!opts.editable;
    var onChange = opts.onChange || function () {};
    var c = data;
    if (!c) return;

    function byId(id) { return document.getElementById(id); }
    function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

    function setTextWithBreaks(el, value) {
      el.textContent = "";
      var lines = String(value || "").split("\n");
      lines.forEach(function (line, i) {
        el.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) el.appendChild(document.createElement("br"));
      });
    }

    // 要素をその場（クリックして直接書き換え）で編集できるようにする
    function bindEditable(el, obj, key, fieldOpts) {
      if (!el) return el;
      fieldOpts = fieldOpts || {};
      var fresh = el.cloneNode(true); // 前回分のイベントを引きずらないよう作り直す
      el.parentNode.replaceChild(fresh, el);
      fresh.contentEditable = "true";
      fresh.classList.add("admin-editable");
      if (fieldOpts.multiline) {
        fresh.classList.add("admin-editable-ml");
      } else {
        fresh.addEventListener("keydown", function (e) {
          if (e.key === "Enter") e.preventDefault();
        });
      }
      if (fresh.tagName === "A") {
        fresh.addEventListener("click", function (e) { e.preventDefault(); });
      }
      fresh.addEventListener("input", function () {
        obj[key] = fresh.innerText;
      });
      return fresh;
    }

    function text(id, obj, key, fieldOpts) {
      var el = byId(id);
      if (!el) return;
      el.textContent = obj[key] || "";
      if (editable) bindEditable(el, obj, key, fieldOpts);
    }

    function linesText(id, obj, key) {
      var el = byId(id);
      if (!el) return;
      if (editable) {
        el.textContent = obj[key] || "";
        bindEditable(el, obj, key, { multiline: true });
      } else {
        setTextWithBreaks(el, obj[key]);
      }
    }

    function addRemoveButton(container, onRemove, btnOpts) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-remove-btn" + (btnOpts && btnOpts.onDark ? " on-dark" : "");
      btn.textContent = "×";
      btn.title = "削除";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      });
      container.appendChild(btn);
    }

    function addAddButton(parent, label, onAdd, btnOpts) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-add-btn" + (btnOpts && btnOpts.onDark ? " on-dark" : "");
      if (btnOpts && btnOpts.fullGrid) btn.style.gridColumn = "1 / -1";
      btn.textContent = label;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        onAdd();
      });
      parent.appendChild(btn);
      return btn;
    }

    // ---- サイト名（ロゴ・フッター） ----
    document.querySelectorAll(".js-site-name").forEach(function (el) {
      el.textContent = c.siteName || "";
      if (editable) {
        var fresh = el.cloneNode(true);
        el.parentNode.replaceChild(fresh, el);
        fresh.contentEditable = "true";
        fresh.classList.add("admin-editable");
        fresh.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
        fresh.addEventListener("input", function () {
          c.siteName = fresh.innerText;
          document.querySelectorAll(".js-site-name").forEach(function (other) {
            if (other !== fresh) other.textContent = c.siteName;
          });
        });
      }
    });

    // ---- ヒーロー ----
    if (c.hero) {
      text("hero-eyebrow", c.hero, "eyebrow");
      text("hero-headline1", c.hero, "headline1");
      text("hero-headline-accent", c.hero, "headlineAccent");
      text("hero-headline2", c.hero, "headline2");
      linesText("hero-lead", c.hero, "lead");
      text("hero-cta", c.hero, "ctaText");

      var igLink = byId("hero-instagram-link");
      if (igLink) igLink.href = (c.contact && c.contact.instagramUrl) || "#";

      var heroAdminFields = byId("hero-admin-fields");
      if (heroAdminFields) {
        clear(heroAdminFields);
        if (editable && c.contact) {
          var igWrap = document.createElement("div");
          igWrap.className = "admin-hidden-field";
          var igLabel = document.createElement("label");
          igLabel.textContent = "InstagramのURL";
          igWrap.appendChild(igLabel);
          var igInput = document.createElement("input");
          igInput.type = "text";
          igInput.value = c.contact.instagramUrl || "";
          igInput.addEventListener("input", function () {
            c.contact.instagramUrl = igInput.value;
            if (igLink) igLink.href = igInput.value || "#";
          });
          igWrap.appendChild(igInput);
          heroAdminFields.appendChild(igWrap);
        }
      }
    }

    // ---- スクールとは ----
    if (c.about) {
      text("about-heading", c.about, "heading");
      text("about-lead", c.about, "lead");
      var aboutContainer = byId("about-cards");
      if (aboutContainer && Array.isArray(c.about.cards)) {
        clear(aboutContainer);
        c.about.cards.forEach(function (card, idx) {
          var div = document.createElement("div");
          div.className = "card" + (editable ? " admin-editing-item" : "");
          div.innerHTML = '<span class="icon"></span><h3></h3><p></p>';
          var iconEl = div.querySelector(".icon");
          var titleEl = div.querySelector("h3");
          var textEl = div.querySelector("p");
          iconEl.textContent = card.icon || "";
          titleEl.textContent = card.title || "";
          textEl.textContent = card.text || "";
          if (editable) {
            bindEditable(iconEl, card, "icon");
            bindEditable(titleEl, card, "title");
            bindEditable(textEl, card, "text", { multiline: true });
            addRemoveButton(div, function () { c.about.cards.splice(idx, 1); onChange(); });
          }
          aboutContainer.appendChild(div);
        });
        if (editable) {
          addAddButton(aboutContainer, "＋ カードを追加", function () {
            c.about.cards.push({ icon: "⚽", title: "新しいカード", text: "" });
            onChange();
          }, { fullGrid: true });
        }
      }
    }

    // ---- 練習日・場所・時間 ----
    if (c.info) {
      text("info-day", c.info, "day");
      text("info-place", c.info, "place");
      text("info-time", c.info, "time");
    }

    // ---- 料金 ----
    if (c.price) {
      text("price-lead", c.price, "lead");
      var priceRows = byId("price-rows");
      if (priceRows && Array.isArray(c.price.rows)) {
        clear(priceRows);
        if (editable) {
          var theadRow = document.querySelector(".price-table thead tr");
          if (theadRow && theadRow.children.length === 2) {
            var thExtra = document.createElement("th");
            thExtra.style.width = "40px";
            theadRow.appendChild(thExtra);
          }
        }
        c.price.rows.forEach(function (row, idx) {
          var tr = document.createElement("tr");
          tr.innerHTML = editable
            ? '<td></td><td class="amount"></td><td></td>'
            : '<td></td><td class="amount"></td>';
          var gradeEl = tr.children[0];
          var amountEl = tr.children[1];
          gradeEl.textContent = row.grade || "";
          amountEl.textContent = row.amount || "";
          if (editable) {
            bindEditable(gradeEl, row, "grade");
            bindEditable(amountEl, row, "amount");
            var delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "admin-cell-del";
            delBtn.textContent = "×";
            delBtn.addEventListener("click", function () { c.price.rows.splice(idx, 1); onChange(); });
            tr.children[2].appendChild(delBtn);
          }
          priceRows.appendChild(tr);
        });
        if (editable) {
          var trAdd = document.createElement("tr");
          var tdAdd = document.createElement("td");
          tdAdd.colSpan = 3;
          tdAdd.style.padding = "12px 20px";
          addAddButton(tdAdd, "＋ 料金の行を追加", function () {
            c.price.rows.push({ grade: "", amount: "" });
            onChange();
          });
          trAdd.appendChild(tdAdd);
          priceRows.appendChild(trAdd);
        }
      }
      var priceNotes = byId("price-notes");
      if (priceNotes && Array.isArray(c.price.notes)) {
        clear(priceNotes);
        c.price.notes.forEach(function (note, idx) {
          var li = document.createElement("li");
          if (editable) {
            li.className = "admin-chip";
            var span = document.createElement("span");
            span.textContent = note;
            li.appendChild(span);
            bindEditable(span, c.price.notes, idx);
            var rm = document.createElement("span");
            rm.className = "admin-chip-remove";
            rm.textContent = "×";
            rm.addEventListener("click", function () { c.price.notes.splice(idx, 1); onChange(); });
            li.appendChild(rm);
          } else {
            li.textContent = note;
          }
          priceNotes.appendChild(li);
        });
        if (editable) {
          var liAdd = document.createElement("li");
          liAdd.style.listStyle = "none";
          liAdd.style.marginTop = "6px";
          addAddButton(liAdd, "＋ 補足を追加", function () {
            c.price.notes.push("新しい補足");
            onChange();
          });
          priceNotes.appendChild(liAdd);
        }
      }
    }

    // ---- 日程（毎週◯曜日を自動計算し、お休みの日だけ管理者が除外） ----
    if (c.schedule) {
      text("schedule-lead", c.schedule, "lead");
      var weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];
      var scheduleWeekday = (c.schedule.weekday !== undefined && c.schedule.weekday !== null) ? c.schedule.weekday : 2;
      c.schedule.offDates = c.schedule.offDates || [];

      // 管理者モード：練習曜日の設定＋お休みの日一覧
      var scheduleAdminFields = byId("schedule-admin-fields");
      if (scheduleAdminFields) {
        clear(scheduleAdminFields);
        if (editable) {
          var weekdayWrap = document.createElement("div");
          weekdayWrap.className = "admin-hidden-field";
          var weekdayLabel = document.createElement("label");
          weekdayLabel.textContent = "練習の曜日";
          weekdayWrap.appendChild(weekdayLabel);
          var weekdaySelect = document.createElement("select");
          weekdayNames.forEach(function (name, i) {
            var opt = document.createElement("option");
            opt.value = i;
            opt.textContent = name + "曜日";
            if (i === scheduleWeekday) opt.selected = true;
            weekdaySelect.appendChild(opt);
          });
          weekdaySelect.addEventListener("change", function () {
            c.schedule.weekday = parseInt(weekdaySelect.value, 10);
            onChange();
          });
          weekdayWrap.appendChild(weekdaySelect);
          scheduleAdminFields.appendChild(weekdayWrap);

          if (c.schedule.offDates.length > 0) {
            var offWrap = document.createElement("div");
            offWrap.className = "admin-hidden-field";
            var offLabel = document.createElement("label");
            offLabel.textContent = "お休みに設定した日（下の日程表の日付をクリックでも切り替えられます）";
            offWrap.appendChild(offLabel);
            var offList = document.createElement("div");
            offList.className = "date-chips";
            c.schedule.offDates.slice().forEach(function (key) {
              var chip = document.createElement("div");
              chip.className = "date-chip admin-chip is-off";
              var span = document.createElement("span");
              span.textContent = key + "（お休み）";
              chip.appendChild(span);
              var rm = document.createElement("span");
              rm.className = "admin-chip-remove";
              rm.textContent = "×";
              rm.addEventListener("click", function () {
                var idx = c.schedule.offDates.indexOf(key);
                if (idx !== -1) c.schedule.offDates.splice(idx, 1);
                onChange();
              });
              chip.appendChild(rm);
              offList.appendChild(chip);
            });
            offWrap.appendChild(offList);
            scheduleAdminFields.appendChild(offWrap);
          }
        }
      }

      var scheduleContainer = byId("schedule-months");
      if (scheduleContainer) {
        clear(scheduleContainer);
        var scheduleToday = new Date();
        scheduleToday.setHours(0, 0, 0, 0);

        var monthWeekdays = function (year, monthIndex, weekday) {
          var out = [];
          var d = new Date(year, monthIndex, 1);
          while (d.getMonth() === monthIndex) {
            if (d.getDay() === weekday) out.push(new Date(d));
            d.setDate(d.getDate() + 1);
          }
          return out;
        };
        var dateKey = function (d) { return (d.getMonth() + 1) + "/" + d.getDate(); };
        var formatDate = function (d) { return dateKey(d) + " (" + weekdayNames[d.getDay()] + ")"; };

        var monthsToShow = [
          { year: scheduleToday.getFullYear(), month: scheduleToday.getMonth() },
          { year: scheduleToday.getMonth() === 11 ? scheduleToday.getFullYear() + 1 : scheduleToday.getFullYear(), month: (scheduleToday.getMonth() + 1) % 12 }
        ];

        monthsToShow.forEach(function (my) {
          var allDates = monthWeekdays(my.year, my.month, scheduleWeekday);
          var visibleDates = editable ? allDates : allDates.filter(function (d) {
            if (c.schedule.offDates.indexOf(dateKey(d)) !== -1) return false;
            if (d < scheduleToday) return false;
            return true;
          });
          if (!editable && visibleDates.length === 0) return; // 訪問者向け表示では、全日程が終わった月は表示しない

          var block = document.createElement("div");
          block.className = "schedule-month";
          var h3 = document.createElement("h3");
          h3.textContent = (my.month + 1) + "月の日程";
          block.appendChild(h3);
          var chips = document.createElement("div");
          chips.className = "date-chips";
          visibleDates.forEach(function (d) {
            var key = dateKey(d);
            var isOff = c.schedule.offDates.indexOf(key) !== -1;
            var chip = document.createElement("div");
            chip.className = "date-chip" + (editable ? " admin-chip" : "") + (isOff ? " is-off" : "");
            chip.textContent = formatDate(d) + (editable && isOff ? "（お休み）" : "");
            if (editable) {
              chip.title = "クリックで「お休み」に設定／解除できます";
              chip.addEventListener("click", function () {
                var idx = c.schedule.offDates.indexOf(key);
                if (idx === -1) c.schedule.offDates.push(key);
                else c.schedule.offDates.splice(idx, 1);
                onChange();
              });
            }
            chips.appendChild(chip);
          });
          block.appendChild(chips);
          scheduleContainer.appendChild(block);
        });
      }
    }

    // ---- トレーニング ----
    if (c.training) {
      var trainingContainer = byId("training-items");
      if (trainingContainer && Array.isArray(c.training.items)) {
        clear(trainingContainer);
        c.training.items.forEach(function (item, idx) {
          var div = document.createElement("div");
          div.className = "card" + (editable ? " admin-editing-item" : "");
          div.innerHTML = '<span class="icon"></span><h3></h3><p><strong></strong></p><p class="desc"></p>';
          var iconEl = div.querySelector(".icon");
          var titleEl = div.querySelector("h3");
          var boldEl = div.querySelector("strong");
          var descEl = div.querySelector(".desc");
          iconEl.textContent = item.icon || "";
          titleEl.textContent = item.title || "";
          boldEl.textContent = item.bold || "";
          descEl.textContent = item.text || "";
          if (editable) {
            bindEditable(iconEl, item, "icon");
            bindEditable(titleEl, item, "title");
            bindEditable(boldEl, item, "bold");
            bindEditable(descEl, item, "text", { multiline: true });
            addRemoveButton(div, function () { c.training.items.splice(idx, 1); onChange(); });
          }
          trainingContainer.appendChild(div);
        });
        if (editable) {
          addAddButton(trainingContainer, "＋ テーマを追加", function () {
            c.training.items.push({ icon: "⚽", title: "今月のテーマ", bold: "", text: "" });
            onChange();
          }, { fullGrid: true });
        }
      }
    }

    // ---- 独り言（最新回・トップページ用） ----
    var diaryActions = byId("diary-admin-actions");
    if (diaryActions) {
      clear(diaryActions);
      if (editable && c.diary && c.diary.latest) {
        var moveBtn = document.createElement("button");
        moveBtn.type = "button";
        moveBtn.className = "admin-move-btn";
        moveBtn.textContent = "📥 今の「独り言」をバックナンバーへ移動して、新しい回を書きはじめる";
        moveBtn.addEventListener("click", function () {
          diaryUndoSnapshot = JSON.parse(JSON.stringify(c.diary));
          var l = c.diary.latest;
          var body = (l.topicHeading || "") + "\n" + (l.topicText || "") + "\n\n" + (l.analysisHeading || "") + "\n" + (l.analysisText || "");
          (l.players || []).forEach(function (p) { body += "\n" + (p.name || "") + "：" + (p.comment || ""); });
          c.diary.archive = c.diary.archive || [];
          c.diary.archive.unshift({ date: l.date, title: l.title, excerpt: body });
          var today = new Date();
          l.date = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
          l.title = "";
          l.topicHeading = "高校サッカー・W杯の話題";
          l.topicText = "";
          l.analysisHeading = "チームの試合分析";
          l.analysisText = "";
          l.players = [];
          onChange();
        });
        diaryActions.appendChild(moveBtn);

        if (diaryUndoSnapshot) {
          var undoBtn = document.createElement("button");
          undoBtn.type = "button";
          undoBtn.className = "admin-move-btn admin-undo-btn";
          undoBtn.textContent = "↩ 直前の「バックナンバーへ移動」を元に戻す（保存前のみ有効）";
          undoBtn.addEventListener("click", function () {
            c.diary = diaryUndoSnapshot;
            diaryUndoSnapshot = null;
            onChange();
          });
          diaryActions.appendChild(undoBtn);
        }
      }
    }
    if (c.diary && c.diary.latest) {
      var d = c.diary.latest;
      text("diary-title", d, "title");
      text("diary-date", d, "date");
      text("diary-topic-heading", d, "topicHeading");
      linesText("diary-topic-text", d, "topicText");
      text("diary-analysis-heading", d, "analysisHeading");
      linesText("diary-analysis-text", d, "analysisText");
      var playersContainer = byId("diary-players");
      if (playersContainer && Array.isArray(d.players)) {
        clear(playersContainer);
        d.players.forEach(function (p, idx) {
          if (editable) {
            var div = document.createElement("div");
            div.className = "player admin-editing-item";
            div.innerHTML = '<span class="player-num"></span><strong></strong>：<span class="player-comment-text"></span>';
            var numEl = div.querySelector(".player-num");
            var nameEl = div.querySelector("strong");
            var commentEl = div.querySelector(".player-comment-text");
            numEl.textContent = (idx + 1) + ".";
            nameEl.textContent = p.name || "";
            commentEl.textContent = p.comment || "";
            bindEditable(nameEl, p, "name");
            bindEditable(commentEl, p, "comment", { multiline: true });
            addRemoveButton(div, function () { d.players.splice(idx, 1); onChange(); }, { onDark: true });
            playersContainer.appendChild(div);
          } else {
            // 選手名をクリックするとコメントが開く（アコーディオン）
            var details = document.createElement("details");
            details.className = "player";
            var summary = document.createElement("summary");
            var numSpan = document.createElement("span");
            numSpan.className = "player-num";
            numSpan.textContent = (idx + 1) + ".";
            summary.appendChild(numSpan);
            summary.appendChild(document.createTextNode(p.name || ""));
            details.appendChild(summary);
            var commentP = document.createElement("p");
            commentP.className = "player-comment";
            setTextWithBreaks(commentP, p.comment);
            details.appendChild(commentP);
            playersContainer.appendChild(details);
          }
        });
        if (editable) {
          addAddButton(playersContainer, "＋ 選手コメントを追加", function () {
            d.players.push({ name: "〇〇選手", comment: "" });
            onChange();
          }, { onDark: true });
        }
      }
    }

    // ---- 独り言バックナンバー（diary.html用） ----
    if (c.diary && Array.isArray(c.diary.archive)) {
      var archiveContainer = byId("archive-list");
      if (archiveContainer) {
        clear(archiveContainer);
        c.diary.archive.forEach(function (entry, idx) {
          var div = document.createElement("div");
          div.className = "archive-item" + (editable ? " admin-editing-item" : "");
          div.innerHTML = '<span class="date"></span><h3></h3><p class="excerpt"></p>';
          var dateEl = div.querySelector(".date");
          var titleEl = div.querySelector("h3");
          var excerptEl = div.querySelector(".excerpt");
          dateEl.textContent = entry.date || "";
          titleEl.textContent = entry.title || "";
          excerptEl.textContent = entry.excerpt || "";
          if (editable) {
            bindEditable(dateEl, entry, "date");
            bindEditable(titleEl, entry, "title");
            bindEditable(excerptEl, entry, "excerpt", { multiline: true });
            addRemoveButton(div, function () { c.diary.archive.splice(idx, 1); onChange(); });
          }
          archiveContainer.appendChild(div);
        });
        if (editable) {
          addAddButton(archiveContainer, "＋ バックナンバーを追加", function () {
            var today = new Date();
            var todayStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
            c.diary.archive.unshift({ date: todayStr, title: "新しい独り言", excerpt: "" });
            onChange();
          });
        }
      }
    }

    // ---- お問い合わせ ----
    function ensureContactField(cardEl, wrapperId, labelText, obj, key, onInputExtra) {
      if (!cardEl) return;
      var wrapper = byId(wrapperId);
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.id = wrapperId;
        wrapper.className = "admin-hidden-field";
        var label = document.createElement("label");
        label.textContent = labelText;
        var input = document.createElement("input");
        input.type = "text";
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        cardEl.appendChild(wrapper);
      }
      var input = wrapper.querySelector("input");
      var freshInput = input.cloneNode(true);
      input.parentNode.replaceChild(freshInput, input);
      freshInput.value = obj[key] || "";
      freshInput.addEventListener("input", function () {
        obj[key] = freshInput.value;
        if (onInputExtra) onInputExtra(freshInput.value);
      });
    }

    if (c.contact) {
      text("contact-lead", c.contact, "lead");
      text("line-note", c.contact, "lineNote");
      document.querySelectorAll(".js-line-link").forEach(function (a) {
        a.href = c.contact.lineUrl || "#";
      });
      text("mail-note", c.contact, "mailNote");
      var mailLink = byId("mail-link");
      if (mailLink) mailLink.href = "mailto:" + (c.contact.mailto || "");

      if (editable) {
        var lineNoteEl = byId("line-note");
        var lineCard = lineNoteEl && lineNoteEl.closest(".contact-card");
        ensureContactField(lineCard, "admin-lineurl-field", "LINE追加URL", c.contact, "lineUrl", function (val) {
          document.querySelectorAll(".js-line-link").forEach(function (a) { a.href = val || "#"; });
        });
        var mailNoteEl = byId("mail-note");
        var mailCard = mailNoteEl && mailNoteEl.closest(".contact-card");
        ensureContactField(mailCard, "admin-mailto-field", "送信先メールアドレス", c.contact, "mailto", function (val) {
          var ml = byId("mail-link");
          if (ml) ml.href = "mailto:" + (val || "");
        });
      } else {
        var f1 = byId("admin-lineurl-field"); if (f1) f1.remove();
        var f2 = byId("admin-mailto-field"); if (f2) f2.remove();
      }
    }

    // ---- フッター ----
    if (c.footer) {
      text("footer-note", c.footer, "note");
      text("footer-copyright", c.footer, "copyright");
    }
  };

  if (window.SITE_CONTENT) {
    window.renderSite(window.SITE_CONTENT, { editable: false });
  }
})();
