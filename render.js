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
  var mangaFixMode = false; // trueの間は、画像をアップロードしても話数を増やさず今の話を上書きする

  // 公開済み（最新話・バックナンバー）の中で一番大きい話数
  function maxPublishedMangaNumber(s) {
    var max = (s.latest && s.latest.number) || 0;
    (s.archive || []).forEach(function (e) { if ((e.number || 0) > max) max = e.number; });
    return max;
  }

  // 次に使う話数（今すぐ公開する場合。下書きが並んでいれば、その続きの番号になる）
  function nextMangaNumber(s) {
    return maxPublishedMangaNumber(s) + (s.queue || []).length + 1;
  }

  // 下書きキュー(queue)の、配列の先頭からidx番目までを一気に公開する
  // （並び順＝公開したときの話数になるので、途中を選んでもそれより前が一緒に公開される）
  function publishQueueThroughIndex(s, idx) {
    s.queue = s.queue || [];
    if (idx < 0 || idx >= s.queue.length) return;
    var toPublish = s.queue.splice(0, idx + 1);
    var base = maxPublishedMangaNumber(s);
    s.archive = s.archive || [];
    if (s.latest && (s.latest.image || s.latest._pendingImage)) {
      s.archive.unshift(s.latest);
    }
    for (var j = 0; j < toPublish.length - 1; j++) {
      toPublish[j].number = base + j + 1;
      s.archive.unshift(toPublish[j]);
    }
    var last = toPublish[toPublish.length - 1];
    last.number = base + toPublish.length;
    s.latest = last;
  }

  // 今の最新話を削除する（バックナンバーがあれば、一番新しいものが繰り上がって最新話になる）
  function removeMangaLatest(s) {
    s.archive = s.archive || [];
    if (s.archive.length > 0) {
      s.latest = s.archive.shift();
    } else {
      s.latest = { number: null, date: "", title: "", image: "", imageUpdatedAt: "" };
    }
  }

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

    // 画像（Blob/File）をdata URLに変換する。失敗時は無反応にせず、はっきりメッセージを出す
    function readImageAsDataURL(blob, onDone) {
      var reader = new FileReader();
      reader.onload = function () { onDone(reader.result); };
      reader.onerror = function () {
        window.alert("画像の読み込みに失敗しました。別の写真で試すか、もう一度お試しください。（ファイルが大きすぎる可能性があります）");
      };
      reader.readAsDataURL(blob);
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

        // 種類（練習メニュー／テーマ／リフティング）。kindが無い古いデータは内容から判定する
        var trainingKindOf = function (item) {
          if (item.kind === "menu" || item.kind === "theme" || item.kind === "lifting") return item.kind;
          if ((item.icon || "").indexOf("リフティング") !== -1) return "lifting";
          if ((item.title || "").indexOf("メニュー") !== -1) return "menu";
          return "theme";
        };
        var trainingGroups = { menu: [], theme: [], lifting: [] };
        c.training.items.forEach(function (item) {
          item.kind = trainingKindOf(item);
          trainingGroups[item.kind].push(item);
        });
        // 並び順は「練習メニュー → テーマ → リフティング」。保存されるitemsもこの順に揃える
        var commitTraining = function () {
          c.training.items = trainingGroups.menu.concat(trainingGroups.theme, trainingGroups.lifting);
          onChange();
        };

        var buildTrainingCard = function (item, group, idx) {
          var div = document.createElement("div");
          div.className = "card" + (editable ? " admin-editing-item" : "");
          if (item.kind === "lifting") {
            div.innerHTML = '<h3></h3><p class="desc"></p>';
          } else {
            div.innerHTML = '<span class="icon"></span><h3></h3><p><strong></strong></p><p class="desc"></p>';
          }
          var iconEl = div.querySelector(".icon");
          var titleEl = div.querySelector("h3");
          var boldEl = div.querySelector("strong");
          var descEl = div.querySelector(".desc");
          if (iconEl) iconEl.textContent = item.icon || "";
          titleEl.textContent = item.title || "";
          if (boldEl) boldEl.textContent = item.bold || "";
          if (editable) {
            descEl.textContent = item.text || "";
          } else {
            setTextWithBreaks(descEl, item.text);
          }
          if (editable) {
            if (iconEl) bindEditable(iconEl, item, "icon");
            bindEditable(titleEl, item, "title");
            if (boldEl) bindEditable(boldEl, item, "bold");
            bindEditable(descEl, item, "text", { multiline: true });
            addMoveButtons(div, group, idx, commitTraining);
            addRemoveButton(div, function () { group.splice(idx, 1); commitTraining(); });
          }
          return div;
        };

        // ① 練習メニュー（予定のトレーニング・1つの別枠）
        trainingGroups.menu.forEach(function (item, idx) {
          var box = document.createElement("div");
          box.className = "training-menu-box" + (editable ? " admin-editing-item" : "");
          box.innerHTML =
            '<div class="training-menu-head">' +
            '<h3><span class="training-menu-ball">⚽</span> <span class="training-menu-title"></span></h3>' +
            '<span class="training-menu-date"></span></div>' +
            '<div class="training-menu-body"></div>';
          var menuTitleEl = box.querySelector(".training-menu-title");
          var menuDateEl = box.querySelector(".training-menu-date");
          var menuBodyEl = box.querySelector(".training-menu-body");
          var menuDate = item.date != null ? item.date : (item.icon || "").replace(/^⚽\s*/, "");
          menuTitleEl.textContent = item.title || "練習メニュー";
          menuDateEl.textContent = menuDate;
          if (editable) {
            menuBodyEl.textContent = item.text || "";
            var dateProxy = {};
            Object.defineProperty(dateProxy, "date", {
              get: function () { return item.date; },
              set: function (v) { item.date = v; item.icon = "⚽" + v; }
            });
            bindEditable(menuTitleEl, item, "title");
            bindEditable(menuDateEl, dateProxy, "date");
            var editableBody = bindEditable(menuBodyEl, item, "text", { multiline: true });
            var menuHint = document.createElement("p");
            menuHint.className = "training-menu-hint";
            menuHint.textContent = "↓ 練習メニューを1行に1つずつ入力してください";
            editableBody.parentNode.insertBefore(menuHint, editableBody);
            addMoveButtons(box, trainingGroups.menu, idx, commitTraining);
            addRemoveButton(box, function () { trainingGroups.menu.splice(idx, 1); commitTraining(); });
            trainingContainer.appendChild(box);
          } else {
            var menuList = document.createElement("ol");
            menuList.className = "training-menu-list";
            String(item.text || "").split("\n").forEach(function (line) {
              line = line.trim();
              if (!line) return;
              var li = document.createElement("li");
              li.textContent = line;
              menuList.appendChild(li);
            });
            menuBodyEl.appendChild(menuList);
            trainingContainer.appendChild(box);
          }
        });
        if (editable && trainingGroups.menu.length === 0) {
          addAddButton(trainingContainer, "＋ 練習メニューを追加", function () {
            trainingGroups.menu.push({ kind: "menu", icon: "⚽", date: "", title: "練習メニュー", bold: "", text: "" });
            commitTraining();
          });
        }

        // ② テーマ・③ リフティング（それぞれ別の見出しでまとめる）
        var addTrainingGroup = function (kind, heading, addLabel, newItem) {
          var group = trainingGroups[kind];
          if (!group.length && !editable) return;
          var wrap = document.createElement("div");
          wrap.className = "training-group";
          var h = document.createElement("h3");
          h.className = "training-sub";
          h.innerHTML = "<span></span>";
          h.firstChild.textContent = heading;
          wrap.appendChild(h);
          var grid = document.createElement("div");
          grid.className = "grid-3";
          group.forEach(function (item, idx) { grid.appendChild(buildTrainingCard(item, group, idx)); });
          if (editable) {
            addAddButton(grid, addLabel, function () { group.push(newItem()); commitTraining(); }, { fullGrid: true });
          }
          wrap.appendChild(grid);
          trainingContainer.appendChild(wrap);
        };
        addTrainingGroup("theme", "🎯 月のテーマ", "＋ テーマを追加", function () {
          return { kind: "theme", icon: "⚽", title: "今月のテーマ", bold: "", text: "" };
        });
        addTrainingGroup("lifting", "⚽ リフティング記録", "＋ リフティング記録を追加", function () {
          return { kind: "lifting", icon: "⚽リフティング", title: "", bold: "", text: "" };
        });
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

      // 管理者モード用：1話分の行を作る（公開済み・下書きどちらも共通。下書きだけチェック＆並び替えつき）
      function buildMangaEpisodeRow(item) {
        var entry = item.entry;
        var displayNum = item.isDraft ? item.draftNumber : (entry.number || "?");
        var row = document.createElement("div");
        row.className = "manga-episode-row admin-editing-item" + (item.isLatest ? " is-latest" : "");

        var mainWrap = document.createElement("div");
        mainWrap.className = "manga-episode-main";
        row.appendChild(mainWrap);

        if (item.isDraft) {
          var checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "manga-queue-check";
          checkbox.checked = !!entry._checked;
          checkbox.addEventListener("change", function () { entry._checked = checkbox.checked; });
          mainWrap.appendChild(checkbox);
        }

        var thumb = document.createElement("img");
        thumb.className = "manga-episode-thumb";
        thumb.src = entry._pendingImage || entry.image || "";
        mainWrap.appendChild(thumb);

        var numLabel = document.createElement("span");
        numLabel.className = "manga-episode-num";
        numLabel.textContent = "第" + displayNum + "話" + (item.isLatest ? "（最新）" : item.isDraft ? "（下書き）" : "");
        mainWrap.appendChild(numLabel);

        var actionsWrap = document.createElement("div");
        actionsWrap.className = "manga-episode-actions";
        row.appendChild(actionsWrap);

        if (item.isDraft) {
          var moveWrap = document.createElement("span");
          moveWrap.className = "manga-queue-move";
          var upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.className = "manga-queue-move-btn";
          upBtn.textContent = "↑";
          upBtn.disabled = item.draftIndex === 0;
          upBtn.addEventListener("click", function () {
            var i = s.queue.indexOf(entry);
            if (i > 0) {
              s.queue.splice(i, 1);
              s.queue.splice(i - 1, 0, entry);
              onChange();
            }
          });
          moveWrap.appendChild(upBtn);
          var downBtn = document.createElement("button");
          downBtn.type = "button";
          downBtn.className = "manga-queue-move-btn";
          downBtn.textContent = "↓";
          downBtn.disabled = item.draftIndex === s.queue.length - 1;
          downBtn.addEventListener("click", function () {
            var i = s.queue.indexOf(entry);
            if (i !== -1 && i < s.queue.length - 1) {
              s.queue.splice(i, 1);
              s.queue.splice(i + 1, 0, entry);
              onChange();
            }
          });
          moveWrap.appendChild(downBtn);
          actionsWrap.appendChild(moveWrap);
        }

        var replaceLabel = document.createElement("label");
        replaceLabel.className = "manga-episode-replace";
        replaceLabel.textContent = "🖼 差し替え";
        var replaceInput = document.createElement("input");
        replaceInput.type = "file";
        replaceInput.accept = "image/*";
        replaceInput.hidden = true;
        replaceInput.addEventListener("change", function () {
          var file = replaceInput.files && replaceInput.files[0];
          if (!file) return;
          resizeImageFile(file, 1400, 0.85, function (blob) {
            readImageAsDataURL(blob, function (dataUrl) {
              if (entry.image) {
                window.__adminPendingDeletes = window.__adminPendingDeletes || [];
                window.__adminPendingDeletes.push(entry.image);
              }
              entry.image = "";
              entry._pendingImage = dataUrl;
              onChange();
            });
          });
          replaceInput.value = "";
        });
        replaceLabel.appendChild(replaceInput);
        actionsWrap.appendChild(replaceLabel);

        addRemoveButton(actionsWrap, function () {
          if (item.isDraft) {
            var qi = s.queue.indexOf(entry);
            if (qi !== -1) s.queue.splice(qi, 1);
            if (entry.image) {
              window.__adminPendingDeletes = window.__adminPendingDeletes || [];
              window.__adminPendingDeletes.push(entry.image);
            }
          } else if (item.isLatest) {
            removeMangaLatest(s);
          } else {
            var idx = s.archive.indexOf(entry);
            if (idx !== -1) s.archive.splice(idx, 1);
          }
          onChange();
        });

        return row;
      }

      // 公開済み（最新話＋バックナンバー）を話数順に並べたもの
      function publishedMangaRows() {
        var rows = [];
        if (s.latest && (s.latest.image || s.latest._pendingImage)) rows.push({ entry: s.latest, isLatest: true });
        (s.archive || []).forEach(function (entry) { rows.push({ entry: entry, isLatest: false }); });
        rows.sort(function (a, b) { return (a.entry.number || 0) - (b.entry.number || 0); });
        return rows;
      }

      var mangaCounterEl = byId("manga-view-counter-series");
      if (mangaCounterEl) {
        if (editable && window.__loadMangaOpenCounter) {
          window.__loadMangaOpenCounter(mangaCounterEl);
        } else {
          mangaCounterEl.textContent = "";
        }
      }

      var mangaActions = byId("manga-admin-actions-series");
      if (mangaActions) {
        clear(mangaActions);
        if (editable && s && s.latest) {
          if (mangaFixMode) {
            var mangaFixNote = document.createElement("p");
            mangaFixNote.className = "admin-modal-note";
            mangaFixNote.textContent = "✏ 修正モードON：次にアップロードする画像は話数を増やさず、今の第" + (s.latest.number || "") + "話に上書きされます。";
            mangaActions.appendChild(mangaFixNote);

            var mangaFixOffBtn = document.createElement("button");
            mangaFixOffBtn.type = "button";
            mangaFixOffBtn.className = "admin-move-btn admin-undo-btn";
            mangaFixOffBtn.textContent = "修正モードを解除する";
            mangaFixOffBtn.addEventListener("click", function () {
              mangaFixMode = false;
              onChange();
            });
            mangaActions.appendChild(mangaFixOffBtn);
          } else {
            var mangaFixBtn = document.createElement("button");
            mangaFixBtn.type = "button";
            mangaFixBtn.className = "admin-move-btn";
            mangaFixBtn.textContent = "✏ 修正モード：今の話の画像だけ直す（話数を増やさない）";
            mangaFixBtn.addEventListener("click", function () {
              mangaFixMode = true;
              onChange();
            });
            mangaActions.appendChild(mangaFixBtn);

            var mangaHint = document.createElement("p");
            mangaHint.className = "admin-modal-note";
            mangaHint.textContent = "下から新しい画像をアップロードすると、今の話は自動でバックナンバーに移動し、新しい話として追加されます。";
            mangaActions.appendChild(mangaHint);
          }

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
        if (mangaLatestImg && mg._pendingImage) mangaLatestImg.src = mg._pendingImage;
        else if (mangaLatestImg && mg.image) mangaLatestImg.src = mg.image + (mg.imageUpdatedAt ? "?v=" + encodeURIComponent(mg.imageUpdatedAt) : "");
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
            mangaLabel.textContent = "4コマ画像をアップロード";
            mangaWrap.appendChild(mangaLabel);
            var mangaInput = document.createElement("input");
            mangaInput.type = "file";
            mangaInput.accept = "image/*";
            mangaInput.addEventListener("change", function () {
              var file = mangaInput.files && mangaInput.files[0];
              if (!file) return;
              resizeImageFile(file, 1400, 0.85, function (blob) {
                readImageAsDataURL(blob, function (dataUrl) {
                  if (mg.image && !mangaFixMode) {
                    mangaUndoSnapshot = JSON.parse(JSON.stringify(s));
                    s.archive = s.archive || [];
                    s.archive.unshift({ number: mg.number, date: mg.date, title: mg.title, image: mg.image, imageUpdatedAt: mg.imageUpdatedAt });
                    var today = new Date();
                    mg.number = nextMangaNumber(s);
                    mg.date = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
                    mg.title = "";
                  }
                  mg.image = "";
                  mangaFixMode = false;
                  mg._pendingImage = dataUrl;
                  onChange();
                  var refreshedImg = byId("manga-latest-img-series");
                  if (refreshedImg) refreshedImg.src = dataUrl;
                });
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

      // ---- 下書きキュー（公開するまで訪問者には見えない、先の話の下書き保存） ----
      var mangaQueueEl = byId("manga-queue-admin-series");
      if (mangaQueueEl) {
        clear(mangaQueueEl);
        if (editable && s) {
          s.queue = s.queue || [];

          var queueTitle = document.createElement("p");
          queueTitle.className = "admin-modal-note";
          queueTitle.textContent = "📦 先の話を下書き保存（公開するまで訪問者には見えません。↑↓で順番を入れ替えられます）";
          mangaQueueEl.appendChild(queueTitle);

          var mangaLineBtn = document.createElement("button");
          mangaLineBtn.type = "button";
          mangaLineBtn.className = "admin-move-btn";
          mangaLineBtn.textContent = "📣 更新をLINEでお知らせ";
          mangaLineBtn.addEventListener("click", function () {
            if (window.__openMangaLineModal) window.__openMangaLineModal();
          });
          mangaQueueEl.appendChild(mangaLineBtn);

          var queueWrap = document.createElement("div");
          queueWrap.className = "admin-hidden-field";
          var queueLabel = document.createElement("label");
          queueLabel.textContent = "新しい下書きの画像をアップロード";
          queueWrap.appendChild(queueLabel);
          var queueInput = document.createElement("input");
          queueInput.type = "file";
          queueInput.accept = "image/*";
          queueInput.addEventListener("change", function () {
            var file = queueInput.files && queueInput.files[0];
            if (!file) return;
            resizeImageFile(file, 1400, 0.85, function (blob) {
              readImageAsDataURL(blob, function (dataUrl) {
                var today = new Date();
                var entry = {
                  date: today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日",
                  title: "",
                  image: "",
                  imageUpdatedAt: ""
                };
                entry._pendingImage = dataUrl;
                s.queue.push(entry);
                onChange();
              });
            });
            queueInput.value = "";
          });
          queueWrap.appendChild(queueInput);
          mangaQueueEl.appendChild(queueWrap);

          var publishedList = publishedMangaRows();
          if (publishedList.length > 0) {
            var publishedTitle = document.createElement("p");
            publishedTitle.className = "admin-modal-note";
            publishedTitle.textContent = "✅ 公開済み（第1話から）";
            mangaQueueEl.appendChild(publishedTitle);
            publishedList.forEach(function (item) {
              mangaQueueEl.appendChild(buildMangaEpisodeRow(item));
            });
          }

          var draftTitle = document.createElement("p");
          draftTitle.className = "admin-modal-note";
          draftTitle.textContent = "📦 下書き";
          mangaQueueEl.appendChild(draftTitle);

          if (s.queue.length === 0) {
            var queueEmpty = document.createElement("p");
            queueEmpty.className = "admin-modal-note";
            queueEmpty.textContent = "下書きはまだありません。";
            mangaQueueEl.appendChild(queueEmpty);
          } else {
            var queueBase = maxPublishedMangaNumber(s);
            s.queue.forEach(function (qItem, qIdx) {
              mangaQueueEl.appendChild(buildMangaEpisodeRow({
                entry: qItem,
                isDraft: true,
                draftNumber: queueBase + qIdx + 1,
                draftIndex: qIdx
              }));
            });

            var publishSelectedBtn = document.createElement("button");
            publishSelectedBtn.type = "button";
            publishSelectedBtn.className = "admin-move-btn";
            publishSelectedBtn.textContent = "🌐 チェックした話まで公開する";
            publishSelectedBtn.addEventListener("click", function () {
              var maxIdx = -1;
              s.queue.forEach(function (item, idx) { if (item._checked) maxIdx = idx; });
              if (maxIdx === -1) {
                window.alert("公開したい話にチェックを入れてください。");
                return;
              }
              s.queue.forEach(function (item) { delete item._checked; });
              publishQueueThroughIndex(s, maxIdx);
              onChange();
            });
            mangaQueueEl.appendChild(publishSelectedBtn);
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

      // ---- 話の並び順データ（index.html / manga.html 共通・モーダルのペア表示に使う） ----
      var episodes = [];
      if (s) {
        if (s.latest && (s.latest.image || s.latest._pendingImage)) episodes.push({ entry: s.latest, isLatest: true });
        (s.archive || []).forEach(function (entry) { episodes.push({ entry: entry, isLatest: false }); });
        episodes.sort(function (a, b) { return (a.entry.number || 0) - (b.entry.number || 0); });
        window.__mangaEpisodesOrdered = episodes.map(function (it) { return it.entry; });
      }

      // ---- 話数の選択リスト（manga.html：右側。管理者モードでは下書きも含めた全話一覧） ----
      var episodeListContainer = byId("manga-episode-list");
      if (episodeListContainer && s) {
        clear(episodeListContainer);

        var listRows = episodes.slice();
        if (editable) {
          s.queue = s.queue || [];
          var listBase = maxPublishedMangaNumber(s);
          s.queue.forEach(function (qItem, qIdx) {
            listRows.push({ entry: qItem, isLatest: false, isDraft: true, draftNumber: listBase + qIdx + 1, draftIndex: qIdx });
          });
          listRows.sort(function (a, b) {
            var an = a.isDraft ? a.draftNumber : (a.entry.number || 0);
            var bn = b.isDraft ? b.draftNumber : (b.entry.number || 0);
            return an - bn;
          });
        }

        listRows.forEach(function (item) {
          var entry = item.entry;
          var displayNum = item.isDraft ? item.draftNumber : (entry.number || "?");

          if (!editable) {
            var row = document.createElement("div");
            row.className = "manga-episode-row" + (item.isLatest ? " is-latest" : "");
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "manga-episode-btn" + (item.isLatest ? " is-current" : "");
            var numSpan = document.createElement("span");
            numSpan.className = "manga-episode-num";
            numSpan.textContent = "第" + displayNum + "話";
            btn.appendChild(numSpan);
            btn.addEventListener("click", function () {
              if (window.openMangaViewer) window.openMangaViewer(entry, "第" + displayNum + "話");
            });
            row.appendChild(btn);
            episodeListContainer.appendChild(row);
            return;
          }
          episodeListContainer.appendChild(buildMangaEpisodeRow(item));
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

  // ---- 4コマ漫画ビューア（index.html / manga.html 共通） ----
  // ・manga-panels.js（window.MANGA_PANELS = { "画像のパス": [[x, y, w, h], ...] }）に、その話の「コマの位置」があれば、
  //   1コマずつ全画面で表示し、タップで次のコマへ進む。x, y, w, h は画像全体に対する割合（0〜1）。
  // ・「コマの位置」が無い話は、これまでどおり1枚の画像で表示する（openMangaWhole）。

  // LINE / X のシェアリンク（labelText は「第12話」など）
  function mangaShareUrls(labelText) {
    var shareText = "テクニカルスクール甘木の4コマ漫画" + (labelText ? "「" + labelText + "」" : "") + " ⚽";
    var pageUrl = new URL("manga.html", location.href).href;
    return {
      line: "https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(pageUrl) + "&text=" + encodeURIComponent(shareText),
      x: "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(pageUrl)
    };
  }

  // その話のコマの位置を返す（無い・おかしい場合は null → 1枚表示にする）
  function mangaPanelsOf(entry) {
    var all = window.MANGA_PANELS;
    var list = all && entry && entry.image && all[entry.image];
    if (!list || !list.length) return null;
    var boxes = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || b.length < 4) return null;
      var x = +b[0], y = +b[1], w = +b[2], h = +b[3];
      if (!isFinite(x + y + w + h) || !(w > 0) || !(h > 0)) return null;
      boxes.push({ x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, 1), h: Math.min(h, 1) });
    }
    return boxes;
  }

  // 次の話（公開済みの話の中で、番号がひとつ大きい話）
  function mangaNextEpisodeOf(entry) {
    var list = window.__mangaEpisodesOrdered || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] === entry || (list[i] && entry && list[i].number === entry.number)) return list[i + 1] || null;
    }
    return null;
  }

  // ---- 1枚の画像でそのまま見せる（コマの位置が無い話・「全体を見る」） ----
  function openMangaWhole(entry, label) {
    var overlay = document.getElementById("manga-modal-overlay");
    if (!overlay || !document.getElementById("manga-modal-img-1")) return;

    function fillPage(n, e) {
      var pageEl = document.getElementById("manga-modal-page-" + n);
      if (!pageEl) return;
      if (!e) { pageEl.hidden = true; return; }
      pageEl.hidden = false;
      var epLabel = "第" + (e.number || "") + "話";
      var t = e.title || "";
      var titleEl = document.getElementById("manga-modal-title-" + n);
      var dateEl = document.getElementById("manga-modal-date-" + n);
      var imgEl = document.getElementById("manga-modal-img-" + n);
      if (titleEl) titleEl.textContent = (t ? (epLabel + "の「" + t + "」") : epLabel) + " ⚽";
      if (dateEl) dateEl.textContent = e.date || "";
      if (imgEl) imgEl.src = e.image ? e.image + (e.imageUpdatedAt ? "?v=" + encodeURIComponent(e.imageUpdatedAt) : "") : "";
    }
    fillPage(1, entry || null);
    fillPage(2, null); // 1枚だけ表示する

    var links = mangaShareUrls(entry ? "第" + (entry.number || "") + "話" : "");
    var lineShare = document.getElementById("manga-share-line");
    var xShare = document.getElementById("manga-share-x");
    if (lineShare) lineShare.href = links.line;
    if (xShare) xShare.href = links.x;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  // ---- 1コマずつ全画面で見せる ----
  var pv = null; // 部品と状態

  function pvQuery(sel) { return pv.root.querySelector(sel); }

  function buildPanelViewer() {
    if (pv) return pv;
    var root = document.createElement("div");
    root.className = "pv-overlay";
    root.hidden = true;
    root.innerHTML =
      '<div class="pv-top">' +
      '  <span class="pv-title"></span>' +
      '  <button type="button" class="pv-btn pv-whole">全体を見る</button>' +
      '  <button type="button" class="pv-close" aria-label="閉じる">✕</button>' +
      '</div>' +
      '<div class="pv-stage">' +
      '  <p class="pv-loading">読み込み中...</p>' +
      '  <div class="pv-frame" hidden><img alt="サッカー4コマ漫画"></div>' +
      '  <div class="pv-end" hidden>' +
      '    <p class="pv-end-title"></p>' +
      '    <button type="button" class="pv-end-btn pv-next-ep">次の話へ ▶</button>' +
      '    <button type="button" class="pv-end-btn pv-again">もう一度読む</button>' +
      '    <div class="manga-share-row">' +
      '      <a href="#" class="share-btn share-line" target="_blank" rel="noopener">LINEで送る</a>' +
      '      <a href="#" class="share-btn share-x" target="_blank" rel="noopener">Xでシェア</a>' +
      '    </div>' +
      '    <a href="manga.html" class="manga-archive-link pv-archive">📚 過去の漫画を見る</a>' +
      '  </div>' +
      '</div>' +
      '<div class="pv-bottom">' +
      '  <button type="button" class="pv-btn pv-prev">‹ 前へ</button>' +
      '  <span class="pv-count"></span>' +
      '  <button type="button" class="pv-btn pv-next">次へ ›</button>' +
      '</div>';
    document.body.appendChild(root);
    pv = { root: root, token: 0, swipedAt: 0, s: null };

    pv.img = pvQuery(".pv-frame img");
    pvQuery(".pv-close").addEventListener("click", closePanelViewer);
    pvQuery(".pv-whole").addEventListener("click", function () {
      var s = pv.s;
      hidePanelViewer();
      if (s) openMangaWhole(s.entry, s.label);
    });
    pvQuery(".pv-prev").addEventListener("click", function () { pvShow(pv.s.idx - 1); });
    pvQuery(".pv-next").addEventListener("click", function () { pvShow(pv.s.idx + 1); });
    pvQuery(".pv-again").addEventListener("click", function () { pvShow(0); });
    pvQuery(".pv-next-ep").addEventListener("click", function () {
      var next = mangaNextEpisodeOf(pv.s.entry);
      if (next && window.openMangaViewer) window.openMangaViewer(next, "第" + (next.number || "") + "話");
    });

    // 画面のタップ：左の3割で前のコマ、それ以外で次のコマ
    var stage = pvQuery(".pv-stage");
    stage.addEventListener("click", function (e) {
      if (!pv.s || pv.s.natW === 0) return;
      if (e.target.closest && e.target.closest(".pv-end")) return; // 最後の画面はボタンだけ
      if (Date.now() - pv.swipedAt < 400) return; // スワイプ直後のクリックは無視
      var rect = stage.getBoundingClientRect();
      if (e.clientX - rect.left < rect.width * 0.3) pvShow(pv.s.idx - 1); else pvShow(pv.s.idx + 1);
    });
    // スワイプ：左へ払うと次、右へ払うと前
    var sx = 0, sy = 0;
    stage.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches[0]) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
    }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (!t || !pv.s || pv.s.natW === 0) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        pv.swipedAt = Date.now();
        pvShow(pv.s.idx + (dx < 0 ? 1 : -1));
      }
    }, { passive: true });

    document.addEventListener("keydown", function (e) {
      if (pv.root.hidden || !pv.s) return;
      if (e.key === "Escape") { closePanelViewer(); return; }
      if (pv.s.natW === 0) return;
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") { e.preventDefault(); pvShow(pv.s.idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); pvShow(pv.s.idx - 1); }
    });
    return pv;
  }

  function hidePanelViewer() {
    if (!pv) return;
    pv.token++; // 読み込み途中の画像を無効にする
    pv.root.hidden = true;
  }

  function closePanelViewer() {
    hidePanelViewer();
    document.body.style.overflow = "";
  }

  // i番目のコマを表示する（最後の次は「おわり」の画面）
  function pvShow(i) {
    var s = pv.s;
    var n = s.boxes.length;
    i = Math.max(0, Math.min(n, i));
    s.idx = i;
    var atEnd = (i === n);
    var frame = pvQuery(".pv-frame");
    var end = pvQuery(".pv-end");
    frame.hidden = atEnd;
    end.hidden = !atEnd;
    pvQuery(".pv-prev").disabled = (i === 0);
    pvQuery(".pv-next").disabled = atEnd;
    pvQuery(".pv-count").textContent = atEnd ? "おわり" : (i + 1) + " / " + n;

    if (atEnd) {
      var next = mangaNextEpisodeOf(s.entry);
      var nextBtn = pvQuery(".pv-next-ep");
      nextBtn.hidden = !next;
      if (next) nextBtn.textContent = "第" + (next.number || "") + "話へ ▶";
      pvQuery(".pv-end-title").textContent = s.label + " おわり ⚽";
      var links = mangaShareUrls(s.label);
      pvQuery(".share-line").href = links.line;
      pvQuery(".share-x").href = links.x;
      pvQuery(".pv-archive").hidden = /manga\.html$/.test(location.pathname);
      return;
    }

    var b = s.boxes[i];
    frame.style.setProperty("--ar", String((b.w * s.natW) / (b.h * s.natH)));
    pv.img.style.width = (100 / b.w) + "%";
    pv.img.style.left = (-b.x / b.w * 100) + "%";
    pv.img.style.top = (-b.y / b.h * 100) + "%";
    frame.classList.remove("pv-in");
    void frame.offsetWidth; // アニメーションをやり直すための再描画
    frame.classList.add("pv-in");
  }

  function openPanelViewer(entry, label, boxes) {
    buildPanelViewer();
    pv.s = { entry: entry, label: label, boxes: boxes, idx: 0, natW: 0, natH: 0 };
    var t = entry.title ? "「" + entry.title + "」" : "";
    pvQuery(".pv-title").textContent = label + t + " ⚽";
    pvQuery(".pv-frame").hidden = true;
    pvQuery(".pv-end").hidden = true;
    var loading = pvQuery(".pv-loading");
    loading.hidden = false;
    pvQuery(".pv-prev").disabled = true;
    pvQuery(".pv-next").disabled = true;
    pvQuery(".pv-count").textContent = "";
    pv.root.hidden = false;
    document.body.style.overflow = "hidden";

    var token = ++pv.token;
    var src = entry.image + (entry.imageUpdatedAt ? "?v=" + encodeURIComponent(entry.imageUpdatedAt) : "");
    function ready() {
      if (token !== pv.token) return;
      pv.s.natW = pv.img.naturalWidth;
      pv.s.natH = pv.img.naturalHeight;
      if (!pv.s.natW || !pv.s.natH) { failed(); return; }
      loading.hidden = true;
      pvShow(0);
    }
    function failed() { // 画像が読めないときは、1枚表示に切り替える
      if (token !== pv.token) return;
      hidePanelViewer();
      openMangaWhole(entry, label);
    }
    pv.img.onload = ready;
    pv.img.onerror = failed;
    if (pv.img.getAttribute("src") === src && pv.img.complete && pv.img.naturalWidth) ready();
    else pv.img.src = src;
  }

  window.openMangaViewer = function (entry, label) {
    var boxes = mangaPanelsOf(entry);
    if (boxes) {
      openPanelViewer(entry, label, boxes);
    } else {
      hidePanelViewer(); // 「次の話へ」で来たときに、1コマ表示が手前に残らないよう先に閉じる
      openMangaWhole(entry, label);
    }

    if (window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path: "manga-open", title: "4コマ漫画を開いた", event: true });
    }
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
