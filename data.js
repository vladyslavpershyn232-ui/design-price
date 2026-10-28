/* Ціни, коефіцієнти та питання опитувальника.
   Цей файл можна правити руками — решта коду нічого не рахує «від себе».
   Звідки взялися цифри — notes/pricing-sources.md і блок «Звідки цифри» на сайті. */
(function (global) {
  'use strict';

  /* Базові ціни у гривнях для рівня «мідл».
     Для новачка та сеньйора множаться на коефіцієнт рівня. */
  var BASE = {
    logo: 8000,          // логотип: знак, основні версії, файли
    identityItem: 1500,  // один носій айдентики
    guide: 4000,         // правила використання, міні-гайд
    page: 800,           // одна шпальта багатосторінкової продукції
    sku: 5000            // одна упаковка або етикетка
  };

  var LEVELS = [
    {
      id: 'junior', title: 'Новачок', short: 'Junior',
      factor: 0.5,
      income: '15 000 – 25 000 ₴ на місяць',
      about: 'Працює за зрозумілим завданням, бере окремі задачі, у портфоліо — роботи, а не кейси.'
    },
    {
      id: 'middle', title: 'Мідл', short: 'Middle',
      factor: 1,
      income: '30 000 – 50 000 ₴ на місяць',
      about: 'Веде проєкт сам: від брифу до готових файлів. Уміє пояснити рішення і працювати з правками.'
    },
    {
      id: 'senior', title: 'Сеньйор', short: 'Senior',
      factor: 1.7,
      income: '50 000 – 70 000 ₴ і вище',
      about: 'Відповідає за бренд цілком, працює зі стратегією та бізнес-задачею, клієнти приходять за рекомендаціями.'
    }
  ];

  /* Опитувальник. За кожну відповідь — бали. Сума ділиться на максимум,
     далі за порогами визначається рівень. */
  var QUESTIONS = [
    {
      q: 'Скільки років займаєтесь дизайном за гроші?',
      options: [
        { text: 'Менше року', score: 0 },
        { text: 'Від року до трьох', score: 1 },
        { text: 'Три роки і більше', score: 2 }
      ]
    },
    {
      q: 'Скільки комерційних проєктів довели до кінця?',
      options: [
        { text: 'До п’яти', score: 0 },
        { text: 'Від п’яти до двадцяти', score: 1 },
        { text: 'Більше двадцяти', score: 2 }
      ]
    },
    {
      q: 'Що у портфоліо?',
      options: [
        { text: 'Окремі роботи та навчальні завдання', score: 0 },
        { text: 'Кілька повноцінних проєктів', score: 1 },
        { text: 'Кейси, де видно задачу і результат для бізнесу', score: 2 }
      ]
    },
    {
      q: 'Хто веде проєкт від брифу до здачі?',
      options: [
        { text: 'Працюю за готовим завданням', score: 0 },
        { text: 'Веду сам, але з підказками', score: 1 },
        { text: 'Веду повністю, разом зі спілкуванням із клієнтом', score: 2 }
      ]
    },
    {
      q: 'Чи працюєте зі змістом бренду — позиціюванням, характером, подачею?',
      options: [
        { text: 'Ні, роблю візуал за задачею', score: 0 },
        { text: 'Іноді, коли клієнт просить', score: 1 },
        { text: 'Так, це частина моєї роботи', score: 2 }
      ]
    },
    {
      q: 'Готуєте файли у друк і спілкуєтесь із типографією?',
      options: [
        { text: 'Ні', score: 0 },
        { text: 'Іноді', score: 1 },
        { text: 'Постійно, знаю вимоги та додрукарську підготовку', score: 2 }
      ]
    },
    {
      q: 'Як відбуваються правки?',
      options: [
        { text: 'Правлю все, що просять, доки клієнт не погодиться', score: 0 },
        { text: 'Є домовленість про кількість правок', score: 1 },
        { text: 'Правки за регламентом, рішення захищаю аргументами', score: 2 }
      ]
    },
    {
      q: 'Чи був проєкт із бюджетом понад 30 000 ₴?',
      options: [
        { text: 'Ні', score: 0 },
        { text: 'Раз або двічі', score: 1 },
        { text: 'Регулярно', score: 2 }
      ]
    },
    {
      q: 'Звідки приходять клієнти?',
      options: [
        { text: 'З бірж і за відгуками на проєкти', score: 0 },
        { text: 'Біржі плюс рекомендації', score: 1 },
        { text: 'Переважно за рекомендаціями та з портфоліо', score: 2 }
      ]
    },
    {
      q: 'Навчаєте інших, ведете команду чи процеси?',
      options: [
        { text: 'Ні', score: 0 },
        { text: 'Іноді допомагаю новачкам', score: 1 },
        { text: 'Так: менторю, веду команду або вибудовую процес', score: 2 }
      ]
    }
  ];

  /* Пороги: частка набраних балів від максимуму. */
  var THRESHOLDS = { middle: 0.35, senior: 0.72 };

  /* Надбавки до підсумку. */
  var MODIFIERS = [
    {
      id: 'urgency', label: 'Терміни',
      options: [
        { text: 'Звичайні', factor: 1, hint: 'робота йде у нормальному темпі' },
        { text: 'Стислі', factor: 1.25, hint: 'доведеться посунути інші задачі' },
        { text: 'Горить', factor: 1.5, hint: 'вихідні та вечори' }
      ]
    },
    {
      id: 'concepts', label: 'Скільки концепцій показуєте',
      options: [
        { text: 'Одну', factor: 1, hint: 'один напрям, далі доопрацювання' },
        { text: 'Дві', factor: 1.15, hint: '' },
        { text: 'Три і більше', factor: 1.3, hint: 'це помітно більше роботи' }
      ]
    },
    {
      id: 'rights', label: 'Права на результат',
      options: [
        { text: 'Звичайна передача', factor: 1, hint: 'клієнт користується, ви показуєте в портфоліо' },
        { text: 'Виключні права', factor: 1.3, hint: 'клієнт отримує все, ви роботу не використовуєте' },
        { text: 'Виключні + без портфоліо', factor: 1.5, hint: 'роботу не можна показувати' }
      ]
    },
    {
      id: 'complexity', label: 'Складність задачі',
      options: [
        { text: 'Звичайна', factor: 1, hint: '' },
        { text: 'Вище за середню', factor: 1.2, hint: 'складна ніша, багато погоджень' },
        { text: 'Висока', factor: 1.4, hint: 'дослідження, багато учасників, жорсткі вимоги' }
      ]
    }
  ];

  /* Знижка за обсяг багатосторінкової продукції: що більше шпальт, то дешевша кожна. */
  function pageFactor(pages) {
    if (pages <= 4) return 1;
    if (pages <= 12) return 0.9;
    if (pages <= 32) return 0.8;
    return 0.7;
  }

  /* Окремі носії — те, що графічний дизайнер робить поштучно, поза брендингом.
     Ціни з українських бірж і прайсів, жовтень 2026. */
  var SINGLES = [
    { id: 'post', label: 'Пост для соцмереж', note: 'один пост або карусель', price: 350,
      countLabel: 'постів', defaultCount: 9, min: 1, bulk: true },
    { id: 'story', label: 'Сторіз', note: 'вертикальний макет під відео чи статику', price: 300,
      countLabel: 'сторіз', defaultCount: 5, min: 1, bulk: true },
    { id: 'highlight', label: 'Іконки та обкладинки актуального', note: 'набір для профілю', price: 150,
      countLabel: 'іконок', defaultCount: 6, min: 1, bulk: true },
    { id: 'banner', label: 'Банер', note: 'веб, реклама, креатив під таргет', price: 400,
      countLabel: 'банерів', defaultCount: 3, min: 1, bulk: true },
    { id: 'card', label: 'Візитівка', note: 'окремо, не в складі айдентики', price: 1200,
      countLabel: 'варіантів', defaultCount: 1, min: 1, bulk: true },
    { id: 'sticker', label: 'Стікери', note: 'набір, від п’яти штук', price: 400,
      countLabel: 'штук', defaultCount: 5, min: 5, bulk: true },
    { id: 'poster', label: 'Постер або афіша', note: 'авторська композиція під друк', price: 2500,
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true },
    { id: 'flyer', label: 'Флаєр, листівка', note: 'дві сторони', price: 1000,
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true },
    { id: 'menu', label: 'Меню', note: 'для закладу, одна сторінка або розворот', price: 2000,
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true },
    { id: 'merch', label: 'Мерч', note: 'принт на футболку, тоут, кепку', price: 1500,
      countLabel: 'принтів', defaultCount: 1, min: 1, bulk: true },
    { id: 'signboard', label: 'Вивіска', note: 'макет під виробництво', price: 2000,
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true },
    { id: 'cover', label: 'Обкладинка', note: 'книга, альбом, зошит', price: 3000,
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true },
    { id: 'certificate', label: 'Сертифікат, грамота', note: 'бланк під друк', price: 1000,
      countLabel: 'штук', defaultCount: 1, min: 1, bulk: true },
    { id: 'pricelist', label: 'Прайс-лист', note: 'одна сторінка', price: 500,
      countLabel: 'сторінок', defaultCount: 1, min: 1, bulk: true }
  ];

  /* Тираж однотипних макетів дешевшає: перший дорожчий за десятий. */
  function bulkFactor(n) {
    if (n <= 2) return 1;
    if (n <= 5) return 0.9;
    if (n <= 12) return 0.8;
    if (n <= 30) return 0.7;
    return 0.6;
  }

  /* Друга і наступні упаковки в одній лінійці дешевші за першу. */
  var EXTRA_SKU_FACTOR = 0.55;

  /* Розкид ринку навколо розрахунку. */
  var SPREAD = 0.25;

  /* Види робіт: підписи для екрана розрахунку. */
  var WORKS = [
    { id: 'logo', label: 'Логотип', note: 'знак, основні версії, файли для друку та екрана', base: 'logo' },
    { id: 'identity', label: 'Айдентика', note: 'візитівки, бланки, вивіска, мерч, шаблони для соцмереж',
      base: 'identityItem', countLabel: 'носіїв', per: 'за носій', defaultCount: 5 },
    { id: 'guide', label: 'Правила використання', note: 'як застосовувати логотип, кольори, шрифти', base: 'guide' },
    { id: 'pages', label: 'Багатосторінкова продукція', note: 'каталог, презентація, брошура',
      base: 'page', countLabel: 'шпальт', per: 'за шпальту', defaultCount: 12 },
    { id: 'packaging', label: 'Упаковка', note: 'коробка, етикетка, флоу-пак',
      base: 'sku', countLabel: 'позицій', per: 'за позицію', defaultCount: 1 }
  ];

  global.PRICING = {
    BASE: BASE, LEVELS: LEVELS, QUESTIONS: QUESTIONS, THRESHOLDS: THRESHOLDS,
    MODIFIERS: MODIFIERS, WORKS: WORKS, SINGLES: SINGLES,
    pageFactor: pageFactor, bulkFactor: bulkFactor,
    EXTRA_SKU_FACTOR: EXTRA_SKU_FACTOR, SPREAD: SPREAD,
    FALLBACK_RATE: 45.59,        // курс на 29.10.2026, якщо НБУ не відповість
    FALLBACK_RATE_DATE: '29.10.2026'
  };
})(this);
