/* Опросник на уровень и расчёт стоимости. Все цифры берутся из data.js. */
(function () {
  'use strict';

  var P = window.PRICING;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var theme = localStorage.getItem('calc_theme') || 'auto';
  function applyTheme() {
    var dark = theme === 'dark' ||
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('theme').textContent = dark ? '☀' : '☾';
  }

  /* ---------- состояние ---------- */

  var answers = {};                  // номер вопроса → индекс ответа
  var level = localStorage.getItem('calc_level') || null;        // выбранный уровень
  var levelFromQuiz = localStorage.getItem('calc_level_quiz') || null; // что показал опросник
  var step = 'quiz';                 // quiz | calc
  var rate = P.FALLBACK_RATE;
  var rateDate = P.FALLBACK_RATE_DATE;
  var rateLive = false;

  var work = {};
  P.WORKS.forEach(function (w, i) {
    work[w.id] = { on: i === 0, count: w.defaultCount || 1 };
  });
  /* Свої ціни поверх типових і власні позиції — усе живе в браузері. */
  function readStore(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }

  var priceOverrides = readStore('calc_prices', {});   // id → базова ціна для мідла
  var customItems = readStore('calc_custom', []);      // власні позиції
  var editPrices = false;

  function allSingles() { return P.SINGLES.concat(customItems); }

  function basePriceOf(item) {
    if (Object.prototype.hasOwnProperty.call(priceOverrides, item.id)) return priceOverrides[item.id];
    return item.base ? P.BASE[item.base] : item.price;
  }

  var singles = {};
  allSingles().forEach(function (w) {
    singles[w.id] = { on: false, count: w.defaultCount || 1 };
  });
  var mods = {};
  P.MODIFIERS.forEach(function (m) { mods[m.id] = 0; });

  /* ---------- курс валют ---------- */

  async function loadRate() {
    try {
      var r = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=usd&json',
        { cache: 'no-store' });
      if (!r.ok) throw new Error('no');
      var d = await r.json();
      if (d && d[0] && d[0].rate) {
        rate = d[0].rate;
        rateDate = d[0].exchangedate || rateDate;
        rateLive = true;
        if (step === 'calc') renderCalc();
      }
    } catch (e) { /* остаёмся на запасном курсе, об этом написано на экране */ }
  }

  /* ---------- опросник ---------- */

  function maxScore() {
    return P.QUESTIONS.reduce(function (n, q) {
      return n + Math.max.apply(null, q.options.map(function (o) { return o.score; }));
    }, 0);
  }

  function scoreToLevel(ratio) {
    if (ratio >= P.THRESHOLDS.senior) return 'senior';
    if (ratio >= P.THRESHOLDS.middle) return 'middle';
    return 'junior';
  }

  function quizDone() { return Object.keys(answers).length === P.QUESTIONS.length; }

  function renderQuiz() {
    $('quiz').innerHTML = P.QUESTIONS.map(function (q, i) {
      var opts = q.options.map(function (o, k) {
        var on = answers[i] === k;
        return '<label class="opt' + (on ? ' on' : '') + '">' +
          '<input type="radio" name="q' + i + '" value="' + k + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(o.text) + '</span></label>';
      }).join('');
      return '<div class="q"><div class="qtext">' + (i + 1) + '. ' + esc(q.q) + '</div>' +
        '<div class="opts">' + opts + '</div></div>';
    }).join('');

    Array.prototype.forEach.call($('quiz').querySelectorAll('input[type=radio]'), function (el) {
      el.onchange = function () {
        answers[Number(el.name.slice(1))] = Number(el.value);
        renderQuiz();
      };
    });

    var answered = Object.keys(answers).length;
    $('quizcount').textContent = answered + ' із ' + P.QUESTIONS.length;
    $('toCalc').disabled = !quizDone();
  }

  function computeLevel() {
    var sum = 0;
    P.QUESTIONS.forEach(function (q, i) {
      if (answers[i] != null) sum += q.options[answers[i]].score;
    });
    return { ratio: sum / maxScore(), sum: sum, max: maxScore() };
  }

  /* ---------- расчёт ---------- */

  function levelData(id) {
    return P.LEVELS.filter(function (l) { return l.id === id; })[0];
  }

  function calculate() {
    var factor = levelData(level).factor;
    var items = [];

    var basePrice = function (id) {
      var w = P.WORKS.filter(function (x) { return x.id === id; })[0];
      return basePriceOf(w);
    };

    if (work.logo.on) {
      items.push({ label: 'Логотип', value: basePrice('logo') * factor });
    }
    if (work.identity.on && work.identity.count > 0) {
      items.push({
        label: 'Айдентика, носіїв: ' + work.identity.count,
        value: basePrice('identity') * work.identity.count * factor
      });
    }
    if (work.guide.on) {
      items.push({ label: 'Правила використання', value: basePrice('guide') * factor });
    }
    if (work.pages.on && work.pages.count > 0) {
      var pf = P.pageFactor(work.pages.count);
      items.push({
        label: 'Багатосторінкова продукція, шпальт: ' + work.pages.count +
          (pf < 1 ? ' (за обсяг −' + Math.round((1 - pf) * 100) + '%)' : ''),
        value: basePrice('pages') * work.pages.count * pf * factor
      });
    }
    if (work.packaging.on && work.packaging.count > 0) {
      var n = work.packaging.count;
      var skuBase = basePrice('packaging');
      var sum = skuBase + (n - 1) * skuBase * P.EXTRA_SKU_FACTOR;
      items.push({
        label: 'Упаковка, позицій: ' + n +
          (n > 1 ? ' (кожна наступна −' + Math.round((1 - P.EXTRA_SKU_FACTOR) * 100) + '%)' : ''),
        value: sum * factor
      });
    }

    allSingles().forEach(function (w) {
      var st = singles[w.id];
      if (!st || !st.on || st.count < 1) return;
      var bf = P.bulkFactor(st.count);
      items.push({
        label: w.label + ' × ' + st.count +
          (bf < 1 ? ' (за тираж −' + Math.round((1 - bf) * 100) + '%)' : ''),
        value: basePriceOf(w) * st.count * bf * factor
      });
    });

    var base = items.reduce(function (s, x) { return s + x.value; }, 0);

    /* Надбавки складаються, а не множаться: три помножені надбавки
       давали подвоєння ціни, і такий рахунок важко захистити перед клієнтом. */
    var extra = 0;
    var modList = [];
    P.MODIFIERS.forEach(function (m) {
      var opt = m.options[mods[m.id]];
      if (opt.factor !== 1) {
        extra += opt.factor - 1;
        modList.push({ label: m.label + ': ' + opt.text, factor: opt.factor });
      }
    });
    var modFactor = 1 + extra;

    // знижка за комплекс рахується від великих робіт, не від поштучних носіїв
    var bigWorks = P.WORKS.filter(function (w) {
      return work[w.id].on && (!w.countLabel || work[w.id].count > 0);
    }).length;
    var discount = P.bundleDiscount(bigWorks);

    var total = base * modFactor * (1 - discount);
    var days = estimateDays();

    return {
      items: items, base: base, modList: modList, modFactor: modFactor,
      discount: discount, bigWorks: bigWorks, days: days,
      total: total,
      tax: total * P.TAX_RATE,
      net: total * (1 - P.TAX_RATE),
      low: total * (1 - P.SPREAD),
      high: total * (1 + P.SPREAD)
    };
  }

  /* Скільки часу це займе. Рахуємо в робочих днях: новачок повільніше,
     сеньйор швидше, стислий термін означає щільнішу роботу, а не менше годин. */
  function estimateDays() {
    var speed = P.SPEED[level] || 1;
    var days = 0;

    if (work.logo.on) days += P.DAYS.logo;
    if (work.identity.on) days += P.DAYS.identityItem * work.identity.count;
    if (work.guide.on) days += P.DAYS.guide;
    if (work.pages.on) days += P.DAYS.page * work.pages.count * P.pageFactor(work.pages.count);
    if (work.packaging.on) days += P.DAYS.sku * work.packaging.count;

    allSingles().forEach(function (w) {
      var st = singles[w.id];
      if (st && st.on && st.count > 0) days += (w.days || 0.5) * st.count * P.bulkFactor(st.count);
    });

    days *= speed;
    var urgency = P.MODIFIERS[0].options[mods.urgency];
    if (urgency.factor > 1.4) days *= 0.5;
    else if (urgency.factor > 1) days *= 0.7;
    return days;
  }

  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  var DAY_FORMS = ['робочий день', 'робочі дні', 'робочих днів'];

  function formatDays(days) {
    if (days < 1) return 'менше дня';
    var n = days < 5 ? Math.round(days * 2) / 2 : Math.round(days);
    var whole = Math.round(n);
    return n + ' ' + plural(whole, DAY_FORMS);
  }

  function money(value) {
    return new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(value));
  }
  function roundNice(value) {
    if (value >= 20000) return Math.round(value / 500) * 500;
    if (value >= 5000) return Math.round(value / 100) * 100;
    return Math.round(value / 50) * 50;
  }

  /* ---------- экран расчёта ---------- */

  function renderLevelCards() {
    $('levelcards').innerHTML = P.LEVELS.map(function (l) {
      return '<button type="button" class="levelcard' + (level === l.id ? ' on' : '') + '" data-level="' + l.id + '">' +
        '<b>' + esc(l.title) + '</b><span class="income">' + esc(l.income) + '</span>' +
        '<div class="about">' + esc(l.about) + '</div></button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-level]'), function (el) {
      el.onclick = function () {
        level = el.dataset.level;
        localStorage.setItem('calc_level', level);
        renderCalc();
      };
    });
  }

  /* Один и тот же вид строки для комплексных работ и для отдельных носителей. */
  function workRow(r, state, unitPrice, attr) {
    var changed = Object.prototype.hasOwnProperty.call(priceOverrides, r.id);
    var priceHtml = editPrices
      ? '<span class="priceedit"><input type="number" min="0" step="50" value="' +
        Math.round(unitPrice) + '" data-price="' + r.id + '"> ₴' +
        (r.per ? ' <i>' + esc(r.per) + '</i>' : '') + '</span>'
      : '<span class="workprice' + (changed ? ' changed' : '') + '">' +
        money(roundNice(unitPrice)) + ' ₴' + (r.per ? ' ' + esc(r.per) : '') + '</span>';

    var body = r.countLabel
      ? '<div class="workbody' + (state.on ? '' : ' off') + '">' +
        '<label class="num">' + esc(r.countLabel) + ' <input type="number" min="' + (r.min || 1) +
        '" max="500" value="' + state.count + '" data-' + attr + 'count="' + r.id + '"></label>' +
        (r.custom ? '<button class="minibtn" data-delcustom="' + esc(r.id) + '">Прибрати позицію</button>' : '') +
        '</div>'
      : '';
    return '<div class="work"><div class="workhead">' +
      '<input type="checkbox" id="' + attr + '-' + r.id + '"' + (state.on ? ' checked' : '') +
      ' data-' + attr + '="' + r.id + '">' +
      '<label for="' + attr + '-' + r.id + '">' + esc(r.label) +
      '<div class="hint">' + esc(r.note) + '</div></label>' +
      priceHtml + '</div>' + body + '</div>';
  }

  function bindRows(attr, store, onCount) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-' + attr + ']'), function (el) {
      el.onchange = function () { store[el.dataset[attr]].on = el.checked; renderCalc(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-' + attr + 'count]'), function (el) {
      el.oninput = function () {
        var min = Number(el.min) || 1;
        var v = Math.max(min, Math.min(500, Number(el.value) || min));
        store[el.dataset[attr + 'count']].count = v;
        // поле показує рівно те, що пішло в розрахунок
        if (String(v) !== el.value) el.value = v;
        renderTotal();
      };
    });
  }

  function renderWorks() {
    var factor = levelData(level).factor;

    $('works').innerHTML = P.WORKS.map(function (r) {
      return workRow(r, work[r.id], basePriceOf(r) * factor, 'work');
    }).join('');

    $('singles').innerHTML = allSingles().map(function (r) {
      if (!singles[r.id]) singles[r.id] = { on: false, count: r.defaultCount || 1 };
      return workRow({
        id: r.id, label: r.label, note: r.note, countLabel: r.countLabel,
        min: r.min, per: 'за штуку', custom: r.custom
      }, singles[r.id], basePriceOf(r) * factor, 'single');
    }).join('');

    bindRows('work', work);
    bindRows('single', singles);
    bindPriceEditing();
  }

  /* Ціну вводять ту, що бачать на екрані, тобто для поточного рівня.
     Зберігаємо базову: тоді інші рівні перерахуються самі. */
  function bindPriceEditing() {
    var factor = levelData(level).factor;
    Array.prototype.forEach.call(document.querySelectorAll('[data-price]'), function (el) {
      var apply = function () {
        var shown = Math.max(0, Number(el.value) || 0);
        priceOverrides[el.dataset.price] = Math.round(shown / factor);
        localStorage.setItem('calc_prices', JSON.stringify(priceOverrides));
        // перераховуємо підсумок одразу, список не чіпаємо: інакше поле втратить фокус
        renderTotal();
        $('resetPrices').classList.remove('hidden');
      };
      el.oninput = apply;
      el.onchange = apply;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-delcustom]'), function (el) {
      el.onclick = function () {
        var id = el.dataset.delcustom;
        customItems = customItems.filter(function (x) { return x.id !== id; });
        delete singles[id];
        delete priceOverrides[id];
        localStorage.setItem('calc_custom', JSON.stringify(customItems));
        localStorage.setItem('calc_prices', JSON.stringify(priceOverrides));
        renderCalc();
      };
    });
  }

  /* Люди пишуть ціну як завгодно: «4 500», «4500 грн», «4,5 тис» не беремо,
     але пробіли, коми й знак гривні прибираємо самі. */
  function parsePrice(text) {
    var clean = String(text || '').replace(/[\s\u00a0']/g, '').replace(',', '.').replace(/[^\d.]/g, '');
    var n = parseFloat(clean);
    return isFinite(n) ? n : 0;
  }

  function addCustomItem() {
    var label = $('customName').value.trim();
    var price = parsePrice($('customPrice').value);

    $('customName').classList.toggle('bad', !label);
    $('customPrice').classList.toggle('bad', price <= 0);

    if (!label || price <= 0) {
      $('customHint').textContent = !label
        ? 'Впишіть назву позиції.'
        : 'Впишіть ціну — число більше за нуль.';
      $('customHint').classList.add('bad');
      return;
    }
    $('customHint').classList.remove('bad');
    var factor = levelData(level).factor;
    var id = 'custom-' + Date.now().toString(36);
    customItems.push({
      id: id, custom: true, label: label,
      note: $('customNote').value.trim() || 'власна позиція',
      price: Math.round(price / factor),
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true,
      days: parsePrice($('customDays').value) || 0.5
    });
    singles[id] = { on: true, count: 1 };
    localStorage.setItem('calc_custom', JSON.stringify(customItems));
    $('customName').value = '';
    $('customPrice').value = '';
    $('customNote').value = '';
    $('customDays').value = '';
    $('customHint').textContent = 'Додано: ' + label + '. Позиція вже у списку, з галочкою.';
    renderCalc();
  }

  function renderMods() {
    $('mods').innerHTML = P.MODIFIERS.map(function (m) {
      var opts = m.options.map(function (o, i) {
        return '<option value="' + i + '"' + (mods[m.id] === i ? ' selected' : '') + '>' + esc(o.text) + '</option>';
      }).join('');
      var hint = m.options[mods[m.id]].hint;
      return '<div class="mod"><b>' + esc(m.label) + '</b>' +
        '<select data-mod="' + m.id + '">' + opts + '</select>' +
        '<div class="modhint">' + esc(hint) + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-mod]'), function (el) {
      el.onchange = function () { mods[el.dataset.mod] = Number(el.value); renderCalc(); };
    });
  }

  function renderTotal() {
    var r = calculate();
    if (!r.items.length) {
      $('total').innerHTML = '<div class="label">Оберіть хоча б одну роботу</div>';
      $('breakdown').innerHTML = '';
      return;
    }

    /* Головне число — сам розрахунок. Вилка поруч і дрібнішим:
       вона показує розкид ринку, а не невизначеність розрахунку. */
    var main = roundNice(r.total);
    var low = roundNice(r.low), high = roundNice(r.high);
    $('total').innerHTML =
      '<div class="label">Вартість робіт</div>' +
      '<div class="money">' + money(main) + ' ₴</div>' +
      '<div class="usd">≈ $' + money(main / rate) + '</div>' +
      '<div class="spread"><b>' + money(low) + ' – ' + money(high) + ' ₴</b>' +
      '<span>Стільки за ту саму роботу просять різні виконавці: ±' +
      Math.round(P.SPREAD * 100) + '% навколо розрахунку. Нижня межа — якщо поступитись, ' +
      'верхня — якщо клієнт складний або робота термінова.</span></div>' +
      '<div class="totalgrid">' +
      '<div><span>Орієнтовний строк</span><b>' + esc(formatDays(r.days)) + '</b></div>' +
      '<div><span>Після 5% ФОП</span><b>' + money(roundNice(r.net)) + ' ₴</b></div>' +
      '</div>' +
      '<div class="rate">Курс ' + rate.toFixed(2) + ' ₴/$ ' +
      (rateLive ? 'за ' + esc(rateDate) + ', НБУ' : '— запасний, на ' + esc(rateDate) + ': курс НБУ не завантажився') +
      '</div>';

    var rows = r.items.map(function (x) {
      return '<div class="brow"><span>' + esc(x.label) + '</span><b>' + money(roundNice(x.value)) + ' ₴</b></div>';
    }).join('');
    if (r.modList.length) {
      rows += r.modList.map(function (m) {
        return '<div class="brow"><span>' + esc(m.label) + '</span><b>×' + m.factor + '</b></div>';
      }).join('');
    }
    if (r.discount) {
      rows += '<div class="brow"><span>Знижка за комплекс (' + r.bigWorks + ' великі роботи)</span><b>−' +
        Math.round(r.discount * 100) + '%</b></div>';
    }
    rows += '<div class="brow sum"><span>Розрахунок</span><b>' + money(roundNice(r.total)) + ' ₴</b></div>';
    rows += '<div class="brow"><span>Єдиний податок 5%</span><b>−' + money(roundNice(r.tax)) + ' ₴</b></div>';
    rows += '<div class="brow"><span>Залишається вам</span><b>' + money(roundNice(r.net)) + ' ₴</b></div>';
    $('breakdown').innerHTML = rows;
  }

  function renderCalc() {
    $('editPrices').textContent = editPrices ? 'Готово' : 'Змінити ціни';
    $('editPrices').classList.toggle('primary', editPrices);
    $('resetPrices').classList.toggle('hidden', !Object.keys(priceOverrides).length);
    $('priceHint').classList.toggle('hidden', !editPrices);
    $('priceHint').textContent = 'Вписуйте свою ціну — підсумок перераховується одразу. ' +
      'Ціна вказується для рівня «' + levelData(level).title + '», для інших рівнів перерахується сама.';
    renderLevelCards();
    renderWorks();
    renderMods();
    renderTotal();

    var l = levelData(level);
    $('levelbadge').innerHTML = levelFromQuiz
      ? '<span class="levelbadge">Опитувальник показав: ' + esc(levelData(levelFromQuiz).title) + '</span>'
      : '';
    $('levelnote').textContent = level === levelFromQuiz || !levelFromQuiz
      ? 'Якщо вважаєте інакше — оберіть інший рівень, розрахунок перерахується.'
      : 'Рівень змінено вручну: ' + l.title + ' замість «' + levelData(levelFromQuiz).title + '».';
  }

  /* ---------- посилання на розрахунок ----------
     Увесь стан кладемо в адресу: можна надіслати клієнту або зберегти собі. */

  function stateToHash() {
    var w = {};
    P.WORKS.forEach(function (x) { if (work[x.id].on) w[x.id] = work[x.id].count; });
    var sg = {};
    allSingles().forEach(function (x) { if (singles[x.id] && singles[x.id].on) sg[x.id] = singles[x.id].count; });
    var usedCustom = customItems.filter(function (x) { return singles[x.id] && singles[x.id].on; })
      .map(function (x) { return { id: x.id, label: x.label, note: x.note, price: x.price, days: x.days }; });
    var payload = { l: level, w: w, s: sg, m: mods };
    if (usedCustom.length) payload.c = usedCustom;
    if (Object.keys(priceOverrides).length) payload.p = priceOverrides;
    return '#' + encodeURIComponent(JSON.stringify(payload));
  }

  function applyHash() {
    if (!location.hash || location.hash.length < 3) return false;
    try {
      var d = JSON.parse(decodeURIComponent(location.hash.slice(1)));
      if (d.l && P.LEVELS.some(function (x) { return x.id === d.l; })) level = d.l;
      P.WORKS.forEach(function (x) {
        work[x.id].on = Object.prototype.hasOwnProperty.call(d.w || {}, x.id);
        if (work[x.id].on) work[x.id].count = Math.max(1, Math.min(500, Number(d.w[x.id]) || 1));
      });
      allSingles().forEach(function (x) {
        if (!singles[x.id]) singles[x.id] = { on: false, count: x.defaultCount || 1 };
        singles[x.id].on = Object.prototype.hasOwnProperty.call(d.s || {}, x.id);
        if (singles[x.id].on) singles[x.id].count = Math.max(x.min || 1, Math.min(500, Number(d.s[x.id]) || 1));
      });
      if (Array.isArray(d.c)) {
        d.c.forEach(function (x) {
          if (!x || !x.id || customItems.some(function (y) { return y.id === x.id; })) return;
          customItems.push({
            id: x.id, custom: true, label: String(x.label || 'Позиція'),
            note: String(x.note || 'власна позиція'), price: Number(x.price) || 0,
            countLabel: 'штук', defaultCount: 1, min: 1, bulk: true, days: Number(x.days) || 0.5
          });
          singles[x.id] = { on: true, count: Number((d.s || {})[x.id]) || 1 };
        });
      }
      if (d.p && typeof d.p === 'object') priceOverrides = Object.assign({}, d.p);
      if (d.m) Object.keys(mods).forEach(function (k) {
        if (typeof d.m[k] === 'number') mods[k] = d.m[k];
      });
      return true;
    } catch (e) { return false; }
  }

  async function copyShareLink() {
    var url = location.origin + location.pathname + stateToHash();
    var btn = $('share');
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Посилання скопійовано';
    } catch (e) {
      location.hash = stateToHash();
      btn.textContent = 'Посилання в адресному рядку';
    }
    setTimeout(function () { btn.textContent = 'Поділитися розрахунком'; }, 2500);
  }

  /* ---------- комерційна пропозиція ---------- */

  /* Комерційна пропозиція як презентація: альбомний A4, слайд на розділ.
     Друк у PDF робить сам браузер — жодних сторонніх бібліотек. */

  var OFFER_CSS =
    '@page{size:A4 landscape;margin:0}' +
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;' +
    'color:#121214;background:#55565c}' +
    '.bar{position:sticky;top:0;z-index:9;background:#121214;color:#fff;padding:12px 20px;' +
    'font-size:13px;display:flex;gap:14px;align-items:center;justify-content:center}' +
    '.bar button{font:inherit;border:0;border-radius:8px;padding:8px 16px;background:#fff;' +
    'color:#121214;font-weight:600;cursor:pointer}' +
    '.slide{width:297mm;height:210mm;padding:17mm 20mm;background:#fff;margin:0 auto 10px;' +
    'page-break-after:always;break-after:page;display:flex;flex-direction:column;position:relative;overflow:hidden}' +
    '.slide:last-child{page-break-after:auto;break-after:auto;margin-bottom:0}' +
    '.num{position:absolute;right:20mm;bottom:12mm;font-size:11px;color:#b6b7bd;letter-spacing:.06em}' +
    '.kicker{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#8b8d95;font-weight:650;margin-bottom:10px}' +
    'h1{font-size:54px;line-height:1.02;letter-spacing:-.03em;margin:0;font-weight:700}' +
    'h2{font-size:30px;line-height:1.12;letter-spacing:-.025em;margin:0 0 20px;font-weight:680}' +
    'h3{font-size:17px;margin:0 0 6px;font-weight:650}' +
    /* обкладинка */
    '.cover{background:#121214;color:#fff;justify-content:space-between}' +
    '.cover .kicker{color:rgba(255,255,255,.55)}' +
    '.cover h1{max-width:20ch}' +
    '.cover .who{display:flex;gap:46px;flex-wrap:wrap;font-size:14px}' +
    '.cover .who span{display:block;color:rgba(255,255,255,.5);font-size:11px;' +
    'text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}' +
    '.cover .who b{font-weight:600;font-size:16px}' +
    '.cover .rule{height:3px;background:#fff;width:64px;margin:26px 0 22px}' +
    '.cover .coverlist{display:flex;gap:9px;flex-wrap:wrap;max-width:75%}' +
    '.cover .coverlist span{border:1px solid rgba(255,255,255,.28);border-radius:99px;' +
    'padding:7px 15px;font-size:13.5px;color:rgba(255,255,255,.82)}' +
    /* що входить */
    '.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;flex:1;align-content:start}' +
    '.cards.one{grid-template-columns:1fr}' +
    '.card{border:1px solid #e6e6e9;border-radius:14px;padding:16px 18px;background:#fafafb}' +
    '.card .qty{font-size:11px;color:#8b8d95;font-weight:500;margin-left:7px}' +
    '.card ul{margin:0;padding-left:16px}' +
    '.card li{font-size:13px;line-height:1.5;color:#36373d;margin-bottom:3px}' +
    '.chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:4px}' +
    '.chip{background:#f0f0f2;border-radius:99px;padding:5px 12px;font-size:12.5px;color:#36373d}' +
    /* етапи */
    '.stages{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;flex:1;align-content:center}' +
    '.stage{border-top:3px solid #121214;padding-top:14px}' +
    '.stage .n{font-size:34px;font-weight:700;letter-spacing:-.03em;line-height:1;margin-bottom:8px}' +
    '.stage p{margin:0;font-size:13.5px;line-height:1.5;color:#55565c}' +
    /* вартість */
    '.costwrap{display:grid;grid-template-columns:1.2fr 1fr;gap:28px;flex:1;align-items:start;' +
    'align-content:center}' +
    '.costright{display:flex;flex-direction:column;gap:18px}' +
    'table{border-collapse:collapse;width:100%}' +
    'td{padding:9px 0;border-bottom:1px solid #ececef;font-size:14px}' +
    'tr.mod td{color:#8b8d95;font-size:13px}' +
    '.n2{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.price{background:#121214;color:#fff;border-radius:18px;padding:24px 26px}' +
    '.price .small{opacity:.55;font-size:12px;text-transform:uppercase;letter-spacing:.1em}' +
    '.price .big{font-size:46px;font-weight:700;letter-spacing:-.03em;margin:6px 0 2px;line-height:1}' +
    '.price .usd{opacity:.6;font-size:14px}' +
    '.terms{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
    '.terms div{border-top:2px solid #121214;padding-top:11px}' +
    '.terms span{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:#8b8d95}' +
    '.terms b{font-size:19px;font-weight:650;letter-spacing:-.02em;display:block;margin-top:3px}' +
    '.why{margin-top:16px;font-size:12.5px;color:#55565c;line-height:1.55;' +
    'background:#fafafb;border-radius:12px;padding:13px 15px}' +
    /* умови */
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:34px;flex:1;align-content:start}' +
    '.two ul{margin:0;padding-left:17px}' +
    '.two li{font-size:14px;line-height:1.55;color:#36373d;margin-bottom:9px}' +
    /* фінал */
    '.final{background:#121214;color:#fff;justify-content:center;align-items:flex-start}' +
    '.final h2{font-size:38px;max-width:20ch;text-wrap:balance}' +
    '.final .kicker{color:rgba(255,255,255,.55)}' +
    '.brief{display:inline-block;margin-top:22px;background:#fff;color:#121214;border-radius:12px;' +
    'padding:15px 22px;font-size:16px;font-weight:600;text-decoration:none;word-break:break-all;max-width:80%}' +
    '.final .contacts{margin-top:34px;font-size:15px;opacity:.75;line-height:1.7}' +
    '@media print{body{background:#fff}.bar{display:none}.slide{margin:0}}';

  function slideNum(n) { return '<div class="num">' + n + '</div>'; }

  function buildOffer() {
    var r = calculate();
    if (!r.items.length) return null;

    var date = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    var author = (localStorage.getItem('calc_author') || '').trim();
    var client = (localStorage.getItem('calc_client') || '').trim();
    var brief = (localStorage.getItem('calc_brief') || '').trim();
    var slides = [];
    var n = 0;

    /* 1. Обкладинка */
    n++;
    /* Назву клієнта не схиляємо — ставимо її заголовком як є. */
    var coverWorks = P.WORKS.filter(function (w) { return work[w.id].on; })
      .map(function (w) { return w.label; })
      .concat(allSingles().filter(function (w) { return singles[w.id] && singles[w.id].on; }).length
        ? ['Окремі макети'] : []);

    slides.push('<div class="slide cover">' +
      '<div><div class="kicker">Комерційна пропозиція</div>' +
      '<h1>' + esc(client || 'Дизайн під ваш проєкт') + '</h1>' +
      '<div class="rule"></div>' +
      '<div class="coverlist">' + coverWorks.map(function (x) {
        return '<span>' + esc(x) + '</span>';
      }).join('') + '</div></div>' +
      '<div class="who">' +
      (author ? '<div><span>Виконавець</span><b>' + esc(author) + '</b></div>' : '') +
      '<div><span>Дата</span><b>' + esc(date) + '</b></div>' +
      '<div><span>Дійсна до</span><b>' +
      esc(new Date(Date.now() + 14 * 864e5).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })) +
      '</b></div>' +
      '</div>' + slideNum(n) + '</div>');

    /* 2. Що буде зроблено — по чотири картки на слайд */
    var chosen = P.WORKS.filter(function (w) { return work[w.id].on; }).map(function (w) {
      var qty = w.countLabel && work[w.id].count > 1
        ? '<span class="qty">' + work[w.id].count + ' ' + esc(w.countLabel) + '</span>' : '';
      return '<div class="card"><h3>' + esc(w.label) + qty + '</h3>' +
        '<ul>' + (w.includes || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    });

    var singlesChosen = allSingles().filter(function (w) { return singles[w.id] && singles[w.id].on; });
    if (singlesChosen.length) {
      chosen.push('<div class="card"><h3>Окремі макети</h3><div class="chips">' +
        singlesChosen.map(function (w) {
          return '<span class="chip">' + esc(w.label) + ' · ' + singles[w.id].count + '</span>';
        }).join('') + '</div></div>');
    }

    for (var i = 0; i < chosen.length; i += 4) {
      n++;
      var part = chosen.slice(i, i + 4);
      slides.push('<div class="slide">' +
        '<div class="kicker">Що буде зроблено' + (chosen.length > 4 ? ' · ' + (Math.floor(i / 4) + 1) : '') + '</div>' +
        '<h2>Обсяг робіт</h2>' +
        '<div class="cards' + (part.length === 1 ? ' one' : '') + '">' + part.join('') + '</div>' +
        slideNum(n) + '</div>');
    }

    /* 3. Як іде робота */
    n++;
    slides.push('<div class="slide">' +
      '<div class="kicker">Процес</div><h2>Як іде робота</h2>' +
      '<div class="stages">' + P.STAGES.map(function (st, k) {
        return '<div class="stage"><div class="n">' + (k + 1) + '</div>' +
          '<h3>' + esc(st.title) + '</h3><p>' + esc(st.text) + '</p></div>';
      }).join('') + '</div>' + slideNum(n) + '</div>');

    /* 4. Вартість */
    n++;
    var main = roundNice(r.total);
    var priceRows = r.items.map(function (x) {
      return '<tr><td>' + esc(x.label) + '</td><td class="n2">' + money(roundNice(x.value)) + ' ₴</td></tr>';
    }).join('');
    var modRows = r.modList.map(function (m) {
      return '<tr class="mod"><td>' + esc(m.label) + '</td><td class="n2">+' +
        Math.round((m.factor - 1) * 100) + '%</td></tr>';
    }).join('');
    var discountRow = r.discount
      ? '<tr class="mod"><td>Знижка за комплекс</td><td class="n2">−' + Math.round(r.discount * 100) + '%</td></tr>' : '';

    var why = [];
    if (r.discount) why.push('Роботи йдуть разом, тому дешевше, ніж поодинці: знижка ' +
      Math.round(r.discount * 100) + '%.');
    r.modList.forEach(function (m) { why.push(esc(m.label) + ' — плюс ' + Math.round((m.factor - 1) * 100) + '%.'); });
    if (!why.length) why.push('Ціна без надбавок: звичайні строки, один напрямок, стандартна передача прав.');

    slides.push('<div class="slide">' +
      '<div class="kicker">Гроші</div><h2>Вартість і з чого вона складається</h2>' +
      '<div class="costwrap"><div><table>' + priceRows + modRows + discountRow + '</table>' +
      '<div class="why">' + why.join(' ') + '</div></div>' +
      '<div class="costright">' +
      '<div class="price"><div class="small">Разом</div>' +
      '<div class="big">' + money(main) + ' ₴</div>' +
      '<div class="usd">≈ $' + money(main / rate) + ' за курсом ' + rate.toFixed(2) + ' ₴/$</div></div>' +
      '<div class="terms">' +
      '<div><span>Строк</span><b>' + esc(formatDays(r.days)) + '</b></div>' +
      '<div><span>Передоплата 50%</span><b>' + money(roundNice(main / 2)) + ' ₴</b></div>' +
      '</div></div></div>' + slideNum(n) + '</div>');

    /* 5. Умови */
    n++;
    slides.push('<div class="slide">' +
      '<div class="kicker">Домовленості</div><h2>Умови роботи</h2>' +
      '<div class="two">' +
      '<div><h3>Як ми працюємо</h3><ul>' +
      P.TERMS.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h3>Що потрібно від вас</h3><ul>' +
      P.CLIENT_NEEDS.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '</div>' + slideNum(n) + '</div>');

    /* 6. Бриф і контакти */
    n++;
    slides.push('<div class="slide final">' +
      '<div class="kicker">Наступний крок</div>' +
      '<h2>' + (brief ? 'Заповніть бриф — і починаємо' : 'Напишіть мені — почнемо з\u00a0брифу') + '</h2>' +
      (brief ? '<a class="brief" href="' + esc(brief) + '">' + esc(brief) + '</a>' : '') +
      '<div class="contacts">' + (author ? esc(author) + '<br>' : '') +
      'Пропозиція дійсна 14 днів від ' + esc(date) + '</div>' +
      slideNum(n) + '</div>');

    return '<!doctype html><html lang="uk"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Комерційна пропозиція' + (client ? ' · ' + esc(client) : '') + '</title>' +
      '<style>' + OFFER_CSS + '</style></head><body>' +
      '<div class="bar">Щоб зберегти у PDF: «Друк» → «Зберегти як PDF», орієнтація альбомна' +
      '<button onclick="window.print()">Зберегти PDF</button></div>' +
      slides.join('') +
      '<scr' + 'ipt>setTimeout(function(){window.print()},700)</scr' + 'ipt>' +
      '</body></html>';
  }

  function openOffer() {
    var html = buildOffer();
    if (!html) return;
    var w = window.open('', '_blank');
    if (!w) {
      // спливаюче вікно заблоковане — віддаємо файлом
      download('propozytsiia.html', html);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function download(name, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime || 'text/html;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- переключение экранов ---------- */

  function show(which) {
    step = which;
    $('screen-quiz').classList.toggle('hidden', which !== 'quiz');
    $('screen-calc').classList.toggle('hidden', which !== 'calc');
    $('step1').className = 'step ' + (which === 'quiz' ? 'on' : 'done');
    $('step2').className = 'step ' + (which === 'calc' ? 'on' : '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- запуск ---------- */

  function init() {
    applyTheme();
    $('theme').onclick = function () {
      theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('calc_theme', theme);
      applyTheme();
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (theme === 'auto') applyTheme();
    });

    renderQuiz();

    $('toCalc').onclick = function () {
      var res = computeLevel();
      levelFromQuiz = scoreToLevel(res.ratio);
      level = levelFromQuiz;
      localStorage.setItem('calc_level', level);
      localStorage.setItem('calc_level_quiz', levelFromQuiz);
      renderCalc();
      show('calc');
    };
    $('skipQuiz').onclick = function () {
      level = level || 'middle';
      localStorage.setItem('calc_level', level);
      renderCalc();
      show('calc');
    };
    ['author', 'client', 'brief'].forEach(function (id) {
      var el = $(id);
      el.value = localStorage.getItem('calc_' + id) || '';
      el.addEventListener('input', function () { localStorage.setItem('calc_' + id, el.value); });
    });

    $('editPrices').onclick = function () {
      editPrices = !editPrices;
      renderCalc();
    };
    $('resetPrices').onclick = function () {
      priceOverrides = {};
      localStorage.removeItem('calc_prices');
      renderCalc();
    };
    $('addCustom').onclick = addCustomItem;
    // Enter у будь-якому полі додає позицію — так швидше, ніж тягтися до кнопки
    ['customName', 'customPrice', 'customNote', 'customDays'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addCustomItem(); }
      });
      $(id).addEventListener('input', function () {
        $(id).classList.remove('bad');
        $('customHint').classList.remove('bad');
      });
    });

    $('share').onclick = copyShareLink;
    $('offer').onclick = openOffer;
    $('backToQuiz').onclick = function () {
      answers = {};
      renderQuiz();
      show('quiz');
    };

    // Розрахунок міг прийти посиланням — тоді одразу показуємо його.
    var fromLink = applyHash();
    if (fromLink) { localStorage.setItem('calc_level', level); }
    if (level || fromLink) {
      renderCalc();
      show('calc');
    }

    $('sourcesBody').innerHTML = SOURCES_HTML;

    loadRate();
    window.__calc = {
      state: function () { return { level: level, levelFromQuiz: levelFromQuiz, work: work, mods: mods }; },
      result: function () { return level ? calculate() : null; },
    offer: function () { return buildOffer(); },
      answer: function (i, k) { answers[i] = k; renderQuiz(); },
      go: show
    };
  }

  var SOURCES_HTML =
    '<p>Ціни зібрані з відкритих українських джерел у жовтні 2026 року. ' +
    'Це орієнтир, а не прайс: ринок розкиданий, тому результат показано вилкою.</p>' +
    '<table>' +
    '<tr><td>Логотип: 8 000 ₴ у мідла</td><td>logochopper, freelance.ua</td></tr>' +
    '<tr><td>Носій айдентики: 1 500 ₴</td><td>logochopper: логотип + айдентика 14 000 ₴</td></tr>' +
    '<tr><td>Правила використання: 4 000 ₴</td><td>FormaInk</td></tr>' +
    '<tr><td>Шпальта багатосторінківки: 800 ₴</td><td>WeLoveBrands, презентації</td></tr>' +
    '<tr><td>Упаковка: 5 000 ₴ за позицію</td><td>Freelancehunt, верх вилки: повноцінна розробка з конструктивом</td></tr>' +
    '<tr><td>Рівні: ×0,5 · ×1 · ×1,7</td><td>ITStep: дохід 15–25 / 30–50 / 50–70+ тис. ₴</td></tr>' +
    '</table>' +
    '<p style="margin-top:14px">Окремі носії, ціни для мідла:</p>' +
    '<table>' +
    '<tr><td>Пост для соцмереж: 450 ₴</td><td>оцінка практикуючої дизайнерки (близько $10)</td></tr>' +
    '<tr><td>Сторіз: 300 ₴</td><td>vizitka.com 350 ₴ за сторіз, стрічка з 9 шт — 1 600 ₴</td></tr>' +
    '<tr><td>Іконки актуального: 250 ₴</td><td>vizitka.com: 6 хайлайтів — 720 ₴; підняте до ринкового мінімуму</td></tr>' +
    '<tr><td>Банер для веба: 750 ₴</td><td>скориговано практикуючою дизайнеркою: біржові 250–500 ₴ занижені</td></tr>' +
    '<tr><td>Прайс-лист: 500 ₴</td><td>прайс дизайнерки в Instagram: 500 ₴, наступна 200 ₴</td></tr>' +
    '<tr><td>Етикетка: 1 500 ₴</td><td>Freelancehunt: дизайн упаковки й етикетки від 700 ₴</td></tr>' +
    '<tr><td>Стікери, флаєр, сертифікат, меню</td><td>скориговано практикуючою дизайнеркою</td></tr>' +
    '<tr><td>Решта носіїв</td><td>оцінка за складністю відносно цих позицій</td></tr>' +
    '</table>' +
    '<p style="margin-top:12px">Мерч навмисно показано орієнтиром: ціна тут сильно залежить ' +
    'від того, скільки позицій, чи є готова айдентика і під яку технологію друку робиться макет.</p>' +
    '<p style="margin-top:12px">Курс гривні до долара підтягується з сайту Національного банку.</p>';

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
