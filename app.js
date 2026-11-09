/* Mini App бронирования — гостевой дом «Кедр».
   Данные и правила повторяют bot.py / content.py бота @kedr_demo_booking_bot. */
(function () {
  "use strict";

  // ===== Данные (синхронно с content.py) =====
  var HOUSES = {
    kedr: {
      title: "Домик «Кедр»", guests_max: 4, price: 7500,
      photos: ["img/kedr.jpg", "img/kedr-2.jpg"],
      about: "Двухэтажный домик с камином и видом на горы. Спальня наверху, диван-кровать внизу, большая терраса."
    },
    sosna: {
      title: "Домик «Сосна»", guests_max: 2, price: 5500,
      photos: ["img/sosna.jpg", "img/sosna-2.jpg"],
      about: "Уютный домик для двоих. Большая кровать, терраса с видом, кофемашина, тёплый пол."
    }
  };
  var EXTRAS = {
    banya: { title: "Баня + чан", price: 4000, thumb: "img/banya-thumb.jpg",
      about: "Русская баня на дровах + горячий чан под открытым небом (3 часа)" },
    breakfast: { title: "Завтрак", price: 500, per_guest: true, thumb: "img/breakfast-thumb.jpg", about: "Домашний завтрак" }
  };
  // ===== Правила (синхронно с bot.py) =====
  var MAX_NIGHTS = 14;
  var BOOK_AHEAD_DAYS = 365;
  var PHONE_RE = /^\+?[\d\s\-()]{10,18}$/;
  var MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август",
    "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
    "сентября", "октября", "ноября", "декабря"];
  var DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  var $ = function (id) { return document.getElementById(id); };

  // ===== Даты (локальные, без часовых поясов) =====
  function mk(y, m, d) { return new Date(y, m, d, 12); }
  function addDays(dt, n) { return mk(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); }
  function fromCompact(s) { return mk(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }
  function diffDays(a, b) { return Math.round((b - a) / 86400000); }
  function human(dt) { return dt.getDate() + " " + MONTHS_GEN[dt.getMonth()] + ", " + DOW[dt.getDay()]; }
  function rub(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽"; }
  function nightsWord(n) {
    if (n % 10 === 1 && n % 100 !== 11) return "ночь";
    if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return "ночи";
    return "ночей";
  }
  function guestsWord(n) {
    if (n % 10 === 1 && n % 100 !== 11) return "гость";
    if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return "гостя";
    return "гостей";
  }

  var now = new Date();
  var TODAY = mk(now.getFullYear(), now.getMonth(), now.getDate());
  var LAST_CI = addDays(TODAY, BOOK_AHEAD_DAYS);

  // ===== Занятые ночи из ?b=house:YYYYMMDD-YYYYMMDD.YYYYMMDD-YYYYMMDD~house2:... =====
  function parseBusy() {
    var busy = {};
    Object.keys(HOUSES).forEach(function (h) { busy[h] = {}; });
    var raw = new URLSearchParams(location.search).get("b") || "";
    raw.split("~").forEach(function (part) {
      var i = part.indexOf(":");
      if (i < 1) return;
      var h = part.slice(0, i);
      if (!busy[h]) return;
      part.slice(i + 1).split(".").forEach(function (r) {
        var m = /^(\d{8})-(\d{8})$/.exec(r);
        if (!m) return;
        var d = fromCompact(m[1]), end = fromCompact(m[2]), guard = 0;
        while (d < end && guard++ < 800) { busy[h][iso(d)] = true; d = addDays(d, 1); }
      });
    });
    return busy;
  }
  var BUSY = parseBusy();

  // ===== Состояние =====
  var st = { h: "kedr", ci: null, co: null, g: 2, extras: {}, view: mk(TODAY.getFullYear(), TODAY.getMonth(), 1) };

  function isBusy(dt) { return !!BUSY[st.h][iso(dt)]; }
  function canCheckIn(dt) { return dt >= TODAY && dt <= LAST_CI && !isBusy(dt); }
  function canCheckOut(dt) {
    if (!st.ci || dt <= st.ci) return false;
    var n = diffDays(st.ci, dt);
    if (n > MAX_NIGHTS) return false;
    for (var d = st.ci; d < dt; d = addDays(d, 1)) if (isBusy(d)) return false;
    return true;
  }
  function nights() { return st.ci && st.co ? diffDays(st.ci, st.co) : 0; }
  function extrasList() { return Object.keys(EXTRAS).filter(function (k) { return st.extras[k]; }); }

  // Как calc_total() в bot.py: проживание × ночи; услуга per_guest — цена × гостей (один раз), иначе фикс.
  function extraCost(id) { var e = EXTRAS[id]; return e.per_guest ? e.price * st.g : e.price; }
  function total() {
    var n = nights();
    if (!n) return 0;
    var t = HOUSES[st.h].price * n;
    extrasList().forEach(function (id) { t += extraCost(id); });
    return t;
  }

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "sel") tg.HapticFeedback.selectionChanged();
      else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) {}
  }
  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  // ===== Домики =====
  var housesBuilt = false;
  function renderHouses() {
    var box = $("houses");
    if (housesBuilt) {
      Array.prototype.forEach.call(box.children, function (c) {
        c.classList.toggle("on", c.dataset.house === st.h);
        c.setAttribute("aria-pressed", c.dataset.house === st.h ? "true" : "false");
      });
      return;
    }
    housesBuilt = true;
    Object.keys(HOUSES).forEach(function (id) {
      var h = HOUSES[id];
      var b = document.createElement("div");
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.className = "house" + (st.h === id ? " on" : "");
      b.dataset.house = id;
      var slides = h.photos.map(function (src, i) {
        return '<img class="house__img" src="' + src + '" alt="" ' + (i ? 'loading="lazy" ' : "") +
          'decoding="async" width="1152" height="864">';
      }).join("");
      var dots = h.photos.length > 1 ? '<div class="house__dots">' + h.photos.map(function (_, i) {
        return "<i" + (i ? "" : ' class="on"') + "></i>";
      }).join("") + "</div>" : "";
      b.innerHTML =
        '<div class="house__media"><div class="house__gallery">' + slides + "</div>" + dots +
        '<span class="house__check">✓ Выбран</span></div>' +
        '<div class="house__body"><div class="house__head"><div class="house__title"></div>' +
        '<div class="house__price">' + rub(h.price) + "<small> / ночь</small></div></div>" +
        '<div class="house__meta">👥 до ' + h.guests_max + " " + guestsWord(h.guests_max) + "</div>" +
        '<div class="house__about"></div></div>';
      b.querySelector(".house__title").textContent = h.title;
      b.querySelector(".house__about").textContent = h.about;
      var gal = b.querySelector(".house__gallery");
      gal.addEventListener("scroll", function () {
        var i = Math.round(gal.scrollLeft / Math.max(1, gal.clientWidth));
        b.querySelectorAll(".house__dots i").forEach(function (d, j) { d.classList.toggle("on", i === j); });
      }, { passive: true });
      b.onclick = function () { selectHouse(id); };
      b.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectHouse(id); } };
      box.appendChild(b);
    });
  }
  function selectHouse(id) {
    if (st.h === id) return;
    st.h = id;
    haptic("sel");
    if (st.g > HOUSES[id].guests_max) st.g = HOUSES[id].guests_max;
    if (st.ci) {
      var co = st.co;
      if (!canCheckIn(st.ci)) { st.ci = st.co = null; toast("В этом домике выбранные даты заняты — выберите другие"); }
      else if (co && !canCheckOut(co)) { st.co = null; toast("Часть ночей занята — выберите дату выезда заново"); }
    }
    render();
  }

  // ===== Календарь =====
  function renderCal() {
    var v = st.view, y = v.getFullYear(), m = v.getMonth();
    $("month").textContent = MONTHS[m] + " " + y;
    $("prev").disabled = y === TODAY.getFullYear() && m === TODAY.getMonth();
    var lastView = st.ci && !st.co ? addDays(st.ci, MAX_NIGHTS) : LAST_CI;
    if (lastView < LAST_CI) lastView = LAST_CI;
    $("next").disabled = y > lastView.getFullYear() || (y === lastView.getFullYear() && m >= lastView.getMonth());

    var grid = $("grid");
    grid.innerHTML = "";
    var first = mk(y, m, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysIn = new Date(y, m + 1, 0).getDate();
    for (var i = 0; i < lead; i++) {
      var e = document.createElement("span"); e.className = "day empty"; grid.appendChild(e);
    }
    for (var d = 1; d <= daysIn; d++) {
      var dt = mk(y, m, d), k = iso(dt);
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = d;
      b.dataset.date = k;
      var cls = ["day"];
      var picking = st.ci && !st.co;
      if (dt < TODAY) cls.push("past");
      else if (isBusy(dt)) cls.push("busy");
      else if (dt > LAST_CI && !(picking && canCheckOut(dt))) cls.push("dis");
      if (picking && canCheckOut(dt)) cls.push("co-ok");
      if (iso(TODAY) === k) cls.push("today");
      if (st.ci && k === iso(st.ci)) { cls.push("start"); if (st.co) cls.push("has-end"); }
      if (st.co && k === iso(st.co)) cls.push("end");
      if (st.ci && st.co && dt > st.ci && dt < st.co) cls.push("mid");
      b.className = cls.join(" ");
      b.onclick = (function (day) { return function () { pickDay(day); }; })(dt);
      grid.appendChild(b);
    }
  }
  function pickDay(dt) {
    if (st.ci && !st.co) {
      if (canCheckOut(dt)) { st.co = dt; haptic("sel"); render(); return; }
      if (dt > st.ci && canCheckIn(dt) === false && dt >= TODAY) {
        if (diffDays(st.ci, dt) > MAX_NIGHTS) toast("Максимум " + MAX_NIGHTS + " ночей за одну бронь");
        else toast("Между датами есть занятые ночи");
        haptic("error");
        return;
      }
      if (dt > st.ci && diffDays(st.ci, dt) > MAX_NIGHTS) {
        toast("Максимум " + MAX_NIGHTS + " ночей — выбран новый день заезда");
      } else if (dt > st.ci) {
        toast("Между датами есть занятые ночи — выбран новый день заезда");
      }
    }
    if (!canCheckIn(dt)) {
      if (dt < TODAY) return;
      haptic("error");
      toast(isBusy(dt) ? "Эта ночь уже занята" : "Бронь открыта на " + BOOK_AHEAD_DAYS + " дней вперёд");
      return;
    }
    st.ci = dt; st.co = null;
    haptic("sel");
    render();
  }
  function renderRange() {
    var r = $("range"), hint = $("date-hint");
    if (!st.ci) { hint.textContent = "Выберите день заезда"; r.className = "range"; return; }
    if (!st.co) {
      hint.textContent = "Теперь выберите день выезда (до " + MAX_NIGHTS + " ночей)";
      r.className = "range show";
      r.textContent = "Заезд: " + human(st.ci) + " · выезд — ?";
      return;
    }
    var n = nights();
    hint.textContent = "Заезд с 14:00, выезд до 12:00";
    r.className = "range show";
    r.innerHTML = "<b>" + human(st.ci) + " → " + human(st.co) + "</b> · " + n + " " + nightsWord(n);
  }

  // ===== Гости =====
  function renderGuests() {
    var max = HOUSES[st.h].guests_max;
    $("g-val").textContent = st.g;
    $("g-max").textContent = guestsWord(st.g) + " · максимум " + max;
    $("g-minus").disabled = st.g <= 1;
    $("g-plus").disabled = st.g >= max;
  }

  // ===== Услуги =====
  function renderExtras() {
    var box = $("extras");
    box.innerHTML = "";
    Object.keys(EXTRAS).forEach(function (id) {
      var e = EXTRAS[id];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "extra" + (st.extras[id] ? " on" : "");
      b.dataset.extra = id;
      b.setAttribute("aria-pressed", st.extras[id] ? "true" : "false");
      b.innerHTML = '<img class="extra__img" src="' + e.thumb + '" alt="" loading="lazy" decoding="async" width="240" height="180">' +
        '<span class="extra__body">' +
        '<div class="extra__title"></div><div class="extra__about"></div></span>' +
        '<span class="extra__price">' + rub(e.price) + (e.per_guest ? " / чел." : "") + "</span>" +
        '<span class="switch"></span>';
      b.querySelector(".extra__title").textContent = e.title;
      b.querySelector(".extra__about").textContent = e.about;
      b.onclick = function () { st.extras[id] = !st.extras[id]; haptic("sel"); render(); };
      box.appendChild(b);
    });
  }

  // ===== Итог =====
  function row(a, b) { return '<div class="row"><span>' + a + "</span><span>" + b + "</span></div>"; }
  function renderSummary() {
    var h = HOUSES[st.h], n = nights(), html = row("Домик", h.title);
    if (n) {
      html += row("Даты", human(st.ci) + " → " + human(st.co));
      html += row("Проживание", rub(h.price) + " × " + n + " " + nightsWord(n) + " = " + rub(h.price * n));
    } else {
      html += row("Даты", "не выбраны");
    }
    html += row("Гостей", String(st.g));
    extrasList().forEach(function (id) {
      var e = EXTRAS[id];
      html += row(e.title, e.per_guest ? rub(e.price) + " × " + st.g + " = " + rub(extraCost(id)) : rub(e.price));
    });
    $("summary").innerHTML = html;
    $("total").textContent = n ? rub(total()) : "—";
  }

  // ===== Проверка и отправка =====
  function nameVal() { return $("name").value.trim().slice(0, 60); }
  function phoneVal() { return $("phone").value.trim().slice(0, 20); }
  function validate(show) {
    var problems = [];
    var datesOk = !!(st.ci && st.co && nights() >= 1 && nights() <= MAX_NIGHTS && st.ci >= TODAY && st.ci <= LAST_CI);
    if (!datesOk) problems.push("sec-dates");
    var nameOk = nameVal().length >= 2, phoneOk = PHONE_RE.test(phoneVal());
    if (!nameOk || !phoneOk) problems.push("sec-contacts");
    if (show) {
      $("sec-dates").classList.toggle("invalid", !datesOk);
      $("name").parentNode.classList.toggle("bad", !nameOk);
      $("phone").parentNode.classList.toggle("bad", !phoneOk);
    }
    return problems;
  }
  function payload() {
    return {
      h: st.h, ci: iso(st.ci), n: nights(), g: st.g,
      name: nameVal(), phone: phoneVal(), extras: extrasList()
    };
  }
  function submit() {
    var problems = validate(true);
    if (problems.length) {
      haptic("error");
      toast(problems[0] === "sec-dates" ? "Выберите даты заезда и выезда" : "Проверьте имя и телефон");
      $(problems[0]).scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    var data = JSON.stringify(payload());
    window.__lastPayload = data;
    if (inTelegram && typeof tg.sendData === "function") {
      haptic("success");
      tg.sendData(data); // Telegram закроет приложение и передаст заявку боту
    } else {
      $("outside-note").hidden = false;
      toast("Отправка работает только внутри Telegram");
    }
  }

  function render() {
    renderHouses(); renderCal(); renderRange(); renderGuests(); renderExtras(); renderSummary();
    if (st.ci && st.co) $("sec-dates").classList.remove("invalid");
  }

  // ===== События =====
  $("prev").onclick = function () { st.view = mk(st.view.getFullYear(), st.view.getMonth() - 1, 1); renderCal(); };
  $("next").onclick = function () { st.view = mk(st.view.getFullYear(), st.view.getMonth() + 1, 1); renderCal(); };
  $("g-minus").onclick = function () { if (st.g > 1) { st.g--; haptic("sel"); render(); } };
  $("g-plus").onclick = function () { if (st.g < HOUSES[st.h].guests_max) { st.g++; haptic("sel"); render(); } };
  ["name", "phone"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      var f = $(id).parentNode;
      if (f.classList.contains("bad")) validate(true);
    });
    $(id).addEventListener("blur", function () {
      if (!$(id).value.trim()) return;
      var ok = id === "name" ? nameVal().length >= 2 : PHONE_RE.test(phoneVal());
      $(id).parentNode.classList.toggle("bad", !ok);
    });
  });
  $("send-fallback").onclick = submit;

  // ===== Telegram =====
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    try { if (tg.colorScheme) document.documentElement.style.colorScheme = tg.colorScheme; } catch (e) {}
    try { tg.setHeaderColor && tg.setHeaderColor("secondary_bg_color"); } catch (e) {}
    try { tg.setBackgroundColor && tg.setBackgroundColor("secondary_bg_color"); } catch (e) {}
  }
  if (inTelegram && tg.MainButton) {
    tg.MainButton.setText("Отправить заявку");
    tg.MainButton.onClick(submit);
    tg.MainButton.show();
  } else {
    $("send-fallback").hidden = false;
  }

  // Имя из профиля Telegram — как подсказка, можно исправить.
  var u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (u && u.first_name && !$("name").value) $("name").value = (u.first_name + (u.last_name ? " " + u.last_name : "")).slice(0, 60);

  render();
})();
