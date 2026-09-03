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
  var mangaUndoSnapshot = null; // 4コマ漫画の「バックナンバーへ移動」の直前状態（1回分だけ・保存前のみ有効）

  window.renderSite = function (data, opts) {
    opts = opts || {};
    var editable = !!opts.editable;
    var onChange = opts.onChange || function () {};
    var c = data;
    if (!c) return;

    function byId(id) { return document.getElementById(id); }
    function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

    // 画像ファイルを指定の最大辺サイズにリサイズしてJPEGに変換（アップロード容量を抑えるため）
    function resizeImageFile(file, maxDim, quality, cb) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { cb(blob || file); }, "image/jpeg", quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); cb(file); };
      img.src = url;
    }

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

    // 一覧の項目を1つ上/下に入れ替えるボタン（並び替え用）
    function addMoveButtons(container, arr, idx, onChange, btnOpts) {
      var wrap = document.createElement("span");
      wrap.className = "admin-move-btns" + (btnOpts && btnOpts.onDark ? " on-dark" : "");
      var upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "admin-move-btn";
      upBtn.textContent = "▲";
      upBtn.title = "上に移動";
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (idx === 0) return;
        var tmp = arr[idx - 1];
        arr[idx - 1] = arr[idx];
        arr[idx] = tmp;
        onChange();
      });
      var downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "admin-move-btn";
      downBtn.textContent = "▼";
      downBtn.title = "下に移動";
      downBtn.disabled = idx === arr.length - 1;
      downBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (idx === arr.length - 1) return;
        var tmp = arr[idx + 1];
        arr[idx + 1] = arr[idx];
        arr[idx] = tmp;
        onChange();
      });
      wrap.appendChild(upBtn);
      wrap.appendChild(downBtn);
      container.appendChild(wrap);
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
      text("hero-badge", c.hero, "badge");
      text("hero-cta", c.hero, "ctaText");

      if (c.contact) text("hero-instagram-link", c.contact, "instagramLabel");
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
      text("info-area", c.info, "area");

      var mapEl = byId("info-map");
      if (mapEl) {
        clear(mapEl);
        if (c.info.mapQuery) {
          var iframe = document.createElement("iframe");
          iframe.loading = "lazy";
          iframe.referrerPolicy = "no-referrer-when-downgrade";
          iframe.src = "https://www.google.com/maps?q=" + encodeURIComponent(c.info.mapQuery) + "&output=embed";
          mapEl.appendChild(iframe);
        }
      }

      var infoAdminFields = byId("info-admin-fields");
      if (infoAdminFields) {
        clear(infoAdminFields);
        if (editable) {
          var mapWrap = document.createElement("div");
          mapWrap.className = "admin-hidden-field";
          var mapLabel = document.createElement("label");
          mapLabel.textContent = "地図の検索キーワード（住所や施設名）";
          mapWrap.appendChild(mapLabel);
          var mapInput = document.createElement("input");
          mapInput.type = "text";
          mapInput.value = c.info.mapQuery || "";
          mapInput.addEventListener("input", function () {
            c.info.mapQuery = mapInput.value;
          });
          mapInput.addEventListener("change", function () { onChange(); });
          mapWrap.appendChild(mapInput);
          infoAdminFields.appendChild(mapWrap);
        }
      }
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
          if (editable) {
            descEl.textContent = item.text || "";
          } else {
            setTextWithBreaks(descEl, item.text);
          }
          if (editable) {
            bindEditable(iconEl, item, "icon");
            bindEditable(titleEl, item, "title");
            bindEditable(boldEl, item, "bold");
            bindEditable(descEl, item, "text", { multiline: true });
            addMoveButtons(div, c.training.items, idx, onChange);
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

    // ---- よくある質問 ----
    if (c.faq) {
      text("faq-heading", c.faq, "heading");
      text("faq-lead", c.faq, "lead");
      var faqContainer = byId("faq-items");
      if (faqContainer && Array.isArray(c.faq.items)) {
        clear(faqContainer);
        c.faq.items.forEach(function (item, idx) {
          var div = document.createElement("div");
          div.className = "card faq-item" + (editable ? " admin-editing-item" : "");
          div.innerHTML = '<h3 class="faq-q"></h3><p class="faq-a"></p>';
          var qEl = div.querySelector(".faq-q");
          var aEl = div.querySelector(".faq-a");
          qEl.textContent = item.q || "";
          aEl.textContent = item.a || "";
          if (editable) {
            bindEditable(qEl, item, "q");
            bindEditable(aEl, item, "a", { multiline: true });
            addRemoveButton(div, function () { c.faq.items.splice(idx, 1); onChange(); });
          }
          faqContainer.appendChild(div);
        });
        if (editable) {
          addAddButton(faqContainer, "＋ 質問を追加", function () {
            c.faq.items.push({ q: "新しい質問", a: "" });
            onChange();
          });
        }
      }
    }

    // ---- 4コマ漫画（チロんぽ・メロんぽ共演、話数で1本につながったシリーズ） ----
    function renderMangaSeries() {
      var s = c.manga && c.manga.series;

      var mangaActions = byId("manga-admin-actions-series");
      if (mangaActions) {
        clear(mangaActions);
        if (editable && s && s.latest) {
          var mangaMoveBtn = document.createElement("button");
          mangaMoveBtn.type = "button";
          mangaMoveBtn.className = "admin-move-btn";
          mangaMoveBtn.textContent = "📥 今の話をバックナンバーへ移動して、新しい話をアップロードする";
          mangaMoveBtn.addEventListener("click", function () {
            mangaUndoSnapshot = JSON.parse(JSON.stringify(s));
            var l = s.latest;
            s.archive = s.archive || [];
            if (l.image) {
              s.archive.unshift({ number: l.number, date: l.date, title: l.title, image: l.image, imageUpdatedAt: l.imageUpdatedAt });
            }
            var today = new Date();
            l.number = (l.number || s.archive.length) + 1;
            l.date = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
            l.title = "";
            l.image = "";
            l.imageUpdatedAt = "";
            window.__adminPendingUploads = window.__adminPendingUploads || {};
            window.__adminPendingUploads.mangaLatest_series = null;
            onChange();
          });
          mangaActions.appendChild(mangaMoveBtn);

          if (mangaUndoSnapshot) {
            var mangaUndoBtn = document.createElement("button");
            mangaUndoBtn.type = "button";
            mangaUndoBtn.className = "admin-move-btn admin-undo-btn";
            mangaUndoBtn.textContent = "↩ 直前の「バックナンバーへ移動」を元に戻す（保存前のみ有効）";
            mangaUndoBtn.addEventListener("click", function () {
              c.manga.series = mangaUndoSnapshot;
              mangaUndoSnapshot = null;
              onChange();
            });
            mangaActions.appendChild(mangaUndoBtn);
          }
        }
      }

      var mangaLatestImg = byId("manga-latest-img-series");
      if (s && s.latest) {
        var mg = s.latest;
        text("manga-date-series", mg, "date");
        var mangaHeroTitle = byId("manga-title-series");
        if (mangaHeroTitle) mangaHeroTitle.hidden = true;

        var mangaLatestDate = byId("manga-latest-date-series");
        var mangaLatestTitle = byId("manga-latest-title-series");
        var mangaLatestCard = byId("manga-latest-card-series");
        var mangaLatestTag = byId("manga-latest-tag-series");
        if (mangaLatestImg && mg.image) mangaLatestImg.src = mg.image + (mg.imageUpdatedAt ? "?v=" + encodeURIComponent(mg.imageUpdatedAt) : "");
        if (mangaLatestDate) mangaLatestDate.textContent = mg.date || "";
        if (mangaLatestTitle) mangaLatestTitle.hidden = true;
        if (mangaLatestTag) mangaLatestTag.textContent = "第" + (mg.number || "") + "話（最新）";
        if (mangaLatestCard) {
          if (!editable) {
            mangaLatestCard.style.cursor = "pointer";
            mangaLatestCard.onclick = function () {
              if (window.openMangaViewer) window.openMangaViewer(mg, "第" + (mg.number || "") + "話");
            };
          } else {
            mangaLatestCard.style.cursor = "";
            mangaLatestCard.onclick = null;
          }
        }

        var mangaAdminFields = byId("manga-admin-fields-series");
        if (mangaAdminFields) {
          clear(mangaAdminFields);
          if (editable) {
            var mangaWrap = document.createElement("div");
            mangaWrap.className = "admin-hidden-field";
            var mangaLabel = document.createElement("label");
            mangaLabel.textContent = "4コマ画像をアップロード（新しい話にするときだけ選択）";
            mangaWrap.appendChild(mangaLabel);
            var mangaInput = document.createElement("input");
            mangaInput.type = "file";
            mangaInput.accept = "image/*";
            mangaInput.addEventListener("change", function () {
              var file = mangaInput.files && mangaInput.files[0];
              if (!file) return;
              resizeImageFile(file, 1400, 0.85, function (blob) {
                var reader = new FileReader();
                reader.onload = function () {
                  window.__adminPendingUploads = window.__adminPendingUploads || {};
                  window.__adminPendingUploads.mangaLatest_series = reader.result;
                  if (mangaLatestImg) mangaLatestImg.src = reader.result;
                };
                reader.readAsDataURL(blob);
              });
            });
            mangaWrap.appendChild(mangaInput);
            var mangaNote = document.createElement("p");
            mangaNote.className = "admin-modal-note";
            mangaNote.textContent = "画像は「保存する」を押したときにアップロードされます。";
            mangaWrap.appendChild(mangaNote);
            mangaAdminFields.appendChild(mangaWrap);
          }
        }
      }

      // ---- 「前の話を見る」リンク（manga.html：最新話カードのすぐ下） ----
      var prevWrap = byId("manga-prev-link-wrap");
      var prevLink = byId("manga-prev-link");
      if (prevWrap && prevLink) {
        var prevEntry = s && s.archive && s.archive[0];
        if (!editable && prevEntry) {
          prevWrap.hidden = false;
          prevLink.textContent = "← 第" + (prevEntry.number || "") + "話を見る";
          prevLink.onclick = function (e) {
            e.preventDefault();
            if (window.openMangaViewer) window.openMangaViewer(prevEntry, "第" + (prevEntry.number || "") + "話");
          };
        } else {
          prevWrap.hidden = true;
        }
      }

      // ---- 話数の選択リスト（manga.html：右側） ----
      var episodeListContainer = byId("manga-episode-list");
      if (episodeListContainer && s) {
        clear(episodeListContainer);
        var episodes = [];
        if (s.latest) episodes.push({ entry: s.latest, isLatest: true });
        (s.archive || []).forEach(function (entry) { episodes.push({ entry: entry, isLatest: false }); });
        episodes.sort(function (a, b) { return (a.entry.number || 0) - (b.entry.number || 0); });

        episodes.forEach(function (item) {
          var entry = item.entry;
          var row = document.createElement("div");
          row.className = "manga-episode-row" + (editable ? " admin-editing-item" : "") + (item.isLatest ? " is-latest" : "");

          if (!editable) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "manga-episode-btn" + (item.isLatest ? " is-current" : "");
            var numSpan = document.createElement("span");
            numSpan.className = "manga-episode-num";
            numSpan.textContent = "第" + (entry.number || "?") + "話";
            btn.appendChild(numSpan);
            btn.addEventListener("click", function () {
              if (window.openMangaViewer) window.openMangaViewer(entry, "第" + (entry.number || "") + "話");
            });
            row.appendChild(btn);
          } else {
            var numLabel = document.createElement("span");
            numLabel.className = "manga-episode-num";
            numLabel.textContent = "第" + (entry.number || "?") + "話" + (item.isLatest ? "（最新・上のカードで編集）" : "");
            row.appendChild(numLabel);
            if (!item.isLatest) {
              addRemoveButton(row, function () {
                var idx = s.archive.indexOf(entry);
                if (idx !== -1) s.archive.splice(idx, 1);
                onChange();
              });
            }
          }
          episodeListContainer.appendChild(row);
        });
        if (!editable && episodes.length === 0) {
          var mangaEmpty = document.createElement("p");
          mangaEmpty.className = "manga-archive-empty";
          mangaEmpty.textContent = "まだ4コマはありません。お楽しみに。";
          episodeListContainer.appendChild(mangaEmpty);
        }
      }
    }

    renderMangaSeries();

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
          if (editable) {
            var div = document.createElement("div");
            div.className = "archive-item admin-editing-item";
            div.innerHTML = '<span class="date"></span><h3></h3><p class="excerpt"></p>';
            var dateEl = div.querySelector(".date");
            var titleEl = div.querySelector("h3");
            var excerptEl = div.querySelector(".excerpt");
            dateEl.textContent = entry.date || "";
            titleEl.textContent = entry.title || "";
            excerptEl.textContent = entry.excerpt || "";
            bindEditable(dateEl, entry, "date");
            bindEditable(titleEl, entry, "title");
            bindEditable(excerptEl, entry, "excerpt", { multiline: true });
            addRemoveButton(div, function () { c.diary.archive.splice(idx, 1); onChange(); });
            archiveContainer.appendChild(div);
          } else {
            // タイトルをクリックすると本文が開く（アコーディオン）
            var details = document.createElement("details");
            details.className = "archive-item";
            var summary = document.createElement("summary");
            var dateSpan = document.createElement("span");
            dateSpan.className = "date";
            dateSpan.textContent = entry.date || "";
            var titleH3 = document.createElement("h3");
            titleH3.textContent = entry.title || "";
            summary.appendChild(dateSpan);
            summary.appendChild(titleH3);
            details.appendChild(summary);
            var excerptP = document.createElement("p");
            excerptP.className = "excerpt";
            setTextWithBreaks(excerptP, entry.excerpt);
            details.appendChild(excerptP);
            archiveContainer.appendChild(details);
          }
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

  // ---- 4コマ漫画モーダル（index.html / manga.html 共通） ----
  window.openMangaViewer = function (entry, label) {
    var overlay = document.getElementById("manga-modal-overlay");
    var imgEl = document.getElementById("manga-modal-img");
    if (!overlay || !imgEl) return;
    var titleEl = document.getElementById("manga-modal-title");
    var dateEl = document.getElementById("manga-modal-date");
    var lineShare = document.getElementById("manga-share-line");
    var xShare = document.getElementById("manga-share-x");

    var title = (entry && entry.title) || "";
    var displayTitle = title ? (label ? (label + "の「" + title + "」") : title) : (label || "サッカー4コマ");
    if (titleEl) titleEl.textContent = displayTitle + " ⚽";
    if (dateEl) dateEl.textContent = (entry && entry.date) || "";
    imgEl.src = (entry && entry.image) ? entry.image + (entry.imageUpdatedAt ? "?v=" + encodeURIComponent(entry.imageUpdatedAt) : "") : "";

    var shareText = "テクニカルスクール甘木の4コマ漫画「" + displayTitle + "」⚽";
    var pageUrl = new URL("manga.html", location.href).href;
    if (lineShare) lineShare.href = "https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(pageUrl) + "&text=" + encodeURIComponent(shareText);
    if (xShare) xShare.href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(pageUrl);

    overlay.hidden = false;
    document.body.style.overflow = "hidden";
  };

  (function initMangaModalChrome() {
    var overlay = document.getElementById("manga-modal-overlay");
    if (!overlay) return;
    var closeBtn = document.getElementById("manga-modal-close");
    function closeModal() {
      overlay.hidden = true;
      document.body.style.overflow = "";
    }
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !overlay.hidden) closeModal(); });
  })();

  if (window.SITE_CONTENT) {
    if (window.MANGA_CONTENT) window.SITE_CONTENT.manga = window.MANGA_CONTENT;
    window.renderSite(window.SITE_CONTENT, { editable: false });
  }
})();
