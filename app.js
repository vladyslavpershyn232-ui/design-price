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

    var modFactor = 1;
    var modList = [];
    P.MODIFIERS.forEach(function (m) {
      var opt = m.options[mods[m.id]];
      if (opt.factor !== 1) {
        modFactor *= opt.factor;
        modList.push({ label: m.label + ': ' + opt.text, factor: opt.factor });
      }
    });

    var total = base * modFactor;
    return {
      items: items, base: base, modList: modList, modFactor: modFactor,
      total: total,
      low: total * (1 - P.SPREAD),
      high: total * (1 + P.SPREAD)
    };
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

    var low = roundNice(r.low), high = roundNice(r.high);
    $('total').innerHTML =
      '<div class="label">Вилка по ринку</div>' +
      '<div class="money">' + money(low) + ' – ' + money(high) + ' ₴</div>' +
      '<div class="usd">≈ $' + money(low / rate) + ' – $' + money(high / rate) + '</div>' +
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
    rows += '<div class="brow sum"><span>Розрахунок</span><b>' + money(roundNice(r.total)) + ' ₴</b></div>';
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
    $('backToQuiz').onclick = function () {
      answers = {};
      renderQuiz();
      show('quiz');
    };

    // Уровень запоминается: второй раз опитувальник проходить не нужно.
    if (level) {
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
    '<tr><td>Упаковка: 5 000 ₴ за позицію</td><td>Freelancehunt: від 700 до 8 000 ₴</td></tr>' +
    '<tr><td>Рівні: ×0,5 · ×1 · ×1,7</td><td>ITStep: дохід 15–25 / 30–50 / 50–70+ тис. ₴</td></tr>' +
    '</table>' +
    '<p style="margin-top:14px">Окремі носії, ціни для мідла:</p>' +
    '<table>' +
    '<tr><td>Пост для соцмереж: 350 ₴</td><td>Kabanchik 150–400 ₴, Freelancehunt 350 ₴ за пост</td></tr>' +
    '<tr><td>Сторіз: 300 ₴</td><td>vizitka.com 350 ₴ за сторіз, стрічка з 9 шт — 1 600 ₴</td></tr>' +
    '<tr><td>Іконки актуального: 150 ₴</td><td>vizitka.com: 6 хайлайтів — 720 ₴; АйФіш: від 50 ₴</td></tr>' +
    '<tr><td>Банер: 400 ₴</td><td>romi.com.ua 250 ₴, freelance.ua 200–500 ₴</td></tr>' +
    '<tr><td>Прайс-лист: 500 ₴</td><td>прайс дизайнерки в Instagram: 500 ₴, наступна 200 ₴</td></tr>' +
    '<tr><td>Решта носіїв</td><td>оцінка за складністю відносно цих позицій — потребує перевірки</td></tr>' +
    '</table>' +
    '<p style="margin-top:12px">Курс гривні до долара підтягується з сайту Національного банку.</p>';

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
