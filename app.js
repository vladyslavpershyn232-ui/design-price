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
  var singles = {};
  P.SINGLES.forEach(function (w) {
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

    if (work.logo.on) {
      items.push({ label: 'Логотип', value: P.BASE.logo * factor });
    }
    if (work.identity.on && work.identity.count > 0) {
      items.push({
        label: 'Айдентика, носіїв: ' + work.identity.count,
        value: P.BASE.identityItem * work.identity.count * factor
      });
    }
    if (work.guide.on) {
      items.push({ label: 'Правила використання', value: P.BASE.guide * factor });
    }
    if (work.pages.on && work.pages.count > 0) {
      var pf = P.pageFactor(work.pages.count);
      items.push({
        label: 'Багатосторінкова продукція, шпальт: ' + work.pages.count +
          (pf < 1 ? ' (за обсяг −' + Math.round((1 - pf) * 100) + '%)' : ''),
        value: P.BASE.page * work.pages.count * pf * factor
      });
    }
    if (work.packaging.on && work.packaging.count > 0) {
      var n = work.packaging.count;
      var sum = P.BASE.sku + (n - 1) * P.BASE.sku * P.EXTRA_SKU_FACTOR;
      items.push({
        label: 'Упаковка, позицій: ' + n +
          (n > 1 ? ' (кожна наступна −' + Math.round((1 - P.EXTRA_SKU_FACTOR) * 100) + '%)' : ''),
        value: sum * factor
      });
    }

    P.SINGLES.forEach(function (w) {
      var st = singles[w.id];
      if (!st.on || st.count < 1) return;
      var bf = P.bulkFactor(st.count);
      items.push({
        label: w.label + ' × ' + st.count +
          (bf < 1 ? ' (за тираж −' + Math.round((1 - bf) * 100) + '%)' : ''),
        value: w.price * st.count * bf * factor
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

    P.SINGLES.forEach(function (w) {
      var st = singles[w.id];
      if (st.on && st.count > 0) days += (w.days || 0.5) * st.count * P.bulkFactor(st.count);
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
    var price = money(roundNice(unitPrice)) + ' ₴' + (r.per ? ' ' + r.per : '');
    var body = r.countLabel
      ? '<div class="workbody' + (state.on ? '' : ' off') + '">' +
        '<label class="num">' + esc(r.countLabel) + ' <input type="number" min="' + (r.min || 1) +
        '" max="500" value="' + state.count + '" data-' + attr + 'count="' + r.id + '"></label></div>'
      : '';
    return '<div class="work"><div class="workhead">' +
      '<input type="checkbox" id="' + attr + '-' + r.id + '"' + (state.on ? ' checked' : '') +
      ' data-' + attr + '="' + r.id + '">' +
      '<label for="' + attr + '-' + r.id + '">' + esc(r.label) +
      '<div class="hint">' + esc(r.note) + '</div></label>' +
      '<span class="workprice">' + esc(price) + '</span></div>' + body + '</div>';
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
      return workRow(r, work[r.id], P.BASE[r.base] * factor, 'work');
    }).join('');

    $('singles').innerHTML = P.SINGLES.map(function (r) {
      return workRow({
        id: r.id, label: r.label, note: r.note, countLabel: r.countLabel,
        min: r.min, per: 'за штуку'
      }, singles[r.id], r.price * factor, 'single');
    }).join('');

    bindRows('work', work);
    bindRows('single', singles);
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
    P.SINGLES.forEach(function (x) { if (singles[x.id].on) sg[x.id] = singles[x.id].count; });
    var payload = { l: level, w: w, s: sg, m: mods };
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
      P.SINGLES.forEach(function (x) {
        singles[x.id].on = Object.prototype.hasOwnProperty.call(d.s || {}, x.id);
        if (singles[x.id].on) singles[x.id].count = Math.max(x.min || 1, Math.min(500, Number(d.s[x.id]) || 1));
      });
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

  function buildOffer() {
    var r = calculate();
    if (!r.items.length) return null;

    var date = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    var author = (localStorage.getItem('calc_author') || '').trim();
    var client = (localStorage.getItem('calc_client') || '').trim();

    /* Блоки «що входить» — тільки для тих робіт, які обрані. */
    var chosen = P.WORKS.filter(function (w) { return work[w.id].on; });
    var scope = chosen.map(function (w) {
      var count = w.countLabel && work[w.id].count > 1
        ? ' <span class="qty">' + work[w.id].count + ' ' + esc(w.countLabel) + '</span>' : '';
      return '<section class="scope"><h3>' + esc(w.label) + count + '</h3>' +
        '<ul>' + (w.includes || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        '</section>';
    }).join('');

    var singlesChosen = P.SINGLES.filter(function (w) { return singles[w.id].on; });
    if (singlesChosen.length) {
      scope += '<section class="scope"><h3>Окремі макети</h3><ul>' +
        singlesChosen.map(function (w) {
          return '<li>' + esc(w.label) + ' — ' + singles[w.id].count + ' шт. <span class="muted">' +
            esc(w.note) + '</span></li>';
        }).join('') + '</ul></section>';
    }

    var priceRows = r.items.map(function (x) {
      return '<tr><td>' + esc(x.label) + '</td><td class="num">' + money(roundNice(x.value)) + ' ₴</td></tr>';
    }).join('');
    var modRows = r.modList.map(function (m) {
      return '<tr class="mod"><td>' + esc(m.label) + '</td><td class="num">+' +
        Math.round((m.factor - 1) * 100) + '%</td></tr>';
    }).join('');
    var discountRow = r.discount
      ? '<tr class="mod"><td>Знижка за комплекс</td><td class="num">−' +
        Math.round(r.discount * 100) + '%</td></tr>' : '';

    var stages = P.STAGES.map(function (st, i) {
      return '<li><b>' + esc(st.title) + '</b><span>' + esc(st.text) + '</span></li>';
    }).join('');

    var listOf = function (items) {
      return '<ul class="plain">' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    };

    var main = roundNice(r.total);

    return '<!doctype html><html lang="uk"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Комерційна пропозиція</title><style>' +
      '*{box-sizing:border-box}' +
      'body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;' +
      'color:#121214;margin:0;background:#f6f6f7}' +
      '.page{max-width:760px;margin:0 auto;background:#fff;padding:56px 56px 48px}' +
      '.head{border-bottom:2px solid #121214;padding-bottom:22px;margin-bottom:34px}' +
      'h1{font-size:30px;letter-spacing:-.025em;margin:0 0 6px;font-weight:680}' +
      '.meta{color:#8b8d95;font-size:13px}' +
      '.meta b{color:#121214;font-weight:550}' +
      'h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8b8d95;' +
      'margin:38px 0 14px;font-weight:650}' +
      '.lead{font-size:16px;line-height:1.6;color:#36373d;margin:0 0 6px}' +
      '.scope{margin-bottom:22px}' +
      '.scope h3{font-size:16px;margin:0 0 8px;font-weight:620}' +
      '.scope .qty{font-size:12px;color:#8b8d95;font-weight:400;margin-left:6px}' +
      '.scope ul{margin:0;padding-left:18px}' +
      '.scope li{margin-bottom:4px;color:#36373d}' +
      '.muted{color:#8b8d95;font-size:13px}' +
      'ol.stages{list-style:none;counter-reset:s;margin:0;padding:0}' +
      'ol.stages li{counter-increment:s;position:relative;padding-left:40px;margin-bottom:16px}' +
      'ol.stages li::before{content:counter(s);position:absolute;left:0;top:1px;width:26px;height:26px;' +
      'border-radius:99px;background:#121214;color:#fff;font-size:13px;display:flex;' +
      'align-items:center;justify-content:center;font-weight:600}' +
      'ol.stages b{display:block;font-size:15px;margin-bottom:2px}' +
      'ol.stages span{color:#55565c;font-size:14px}' +
      'ul.plain{margin:0;padding-left:18px}' +
      'ul.plain li{margin-bottom:6px;color:#36373d}' +
      'table{border-collapse:collapse;width:100%}' +
      'td{padding:11px 0;border-bottom:1px solid #e6e6e9;font-size:14px}' +
      'tr.mod td{color:#8b8d95}' +
      '.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.total{margin-top:26px;padding:24px 26px;background:#121214;color:#fff;border-radius:16px}' +
      '.total .small{opacity:.6;font-size:13px}' +
      '.total .big{font-size:34px;font-weight:680;letter-spacing:-.025em;margin:4px 0 2px}' +
      '.total .row{display:flex;gap:34px;flex-wrap:wrap;margin-top:18px;padding-top:16px;' +
      'border-top:1px solid rgba(255,255,255,.16)}' +
      '.total .row div span{display:block;opacity:.6;font-size:12px}' +
      '.total .row div b{font-size:16px;font-weight:620}' +
      '.foot{margin-top:40px;padding-top:20px;border-top:1px solid #e6e6e9;' +
      'color:#8b8d95;font-size:12.5px;line-height:1.6}' +
      '@media print{body{background:#fff}.page{padding:0;max-width:none}}' +
      '@media (max-width:640px){.page{padding:28px 20px}h1{font-size:24px}.total .big{font-size:27px}}' +
      '</style></head><body><div class="page">' +

      '<div class="head"><h1>Комерційна пропозиція</h1>' +
      '<div class="meta">' + esc(date) +
      (client ? ' · для <b>' + esc(client) + '</b>' : '') +
      (author ? ' · від <b>' + esc(author) + '</b>' : '') +
      '</div></div>' +

      '<p class="lead">Нижче — що саме буде зроблено, як іде робота, скільки це коштує ' +
      'і що потрібно з вашого боку. Якщо щось не підходить, обсяг можна змінити — ' +
      'вартість перерахується.</p>' +

      '<h2>Що входить</h2>' + scope +

      '<h2>Як іде робота</h2><ol class="stages">' + stages + '</ol>' +

      '<h2>Вартість</h2>' +
      '<table>' + priceRows + modRows + discountRow + '</table>' +
      '<div class="total">' +
      '<div class="small">Разом</div>' +
      '<div class="big">' + money(main) + ' ₴</div>' +
      '<div class="small">≈ $' + money(main / rate) + ' за курсом ' + rate.toFixed(2) + ' ₴/$</div>' +
      '<div class="row">' +
      '<div><span>Строк</span><b>' + esc(formatDays(r.days)) + '</b></div>' +
      '<div><span>Передоплата 50%</span><b>' + money(roundNice(main / 2)) + ' ₴</b></div>' +
      '</div></div>' +

      '<h2>Умови</h2>' + listOf(P.TERMS) +
      '<h2>Що потрібно від вас</h2>' + listOf(P.CLIENT_NEEDS) +

      '<div class="foot">Пропозиція дійсна 14 днів від дати складання. ' +
      'Остаточна вартість фіксується після брифу, коли стає зрозумілим точний обсяг.' +
      (author ? '<br>' + esc(author) : '') +
      '</div></div></body></html>';
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
    ['author', 'client'].forEach(function (id) {
      var el = $(id);
      el.value = localStorage.getItem('calc_' + id) || '';
      el.addEventListener('input', function () { localStorage.setItem('calc_' + id, el.value); });
    });

    $('share').onclick = copyShareLink;
    $('offer').onclick = function () {
      var html = buildOffer();
      if (!html) return;
      download('propozytsiia.html', html);
    };
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
