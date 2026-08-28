/* =========================================================================
   6PACK. Вёрстка и типографика повторяют оригинал, поведение написано
   заново: фигура крутится настоящим рендером, числа читаются из цепи.

   Разделение, которое здесь главное:
     ЧИТАЕТСЯ ИЗ ЦЕПИ — корзина, цены, изменение за сутки, ликвидность,
       объёмы. Это правда.
     СЧИТАЕТСЯ ПО МОДЕЛИ — сколько собрала бы казна и сколько досталось бы
       холдеру. Арифметика на живых числах и одном допущении, названном вслух.
     НЕ СУЩЕСТВУЕТ — цена $6PACK, холдеры, история выплат. Этого на странице
       нет: сайт не должен обещать больше, чем умеет код.
   ========================================================================= */

const BRAND = {
  name: '6PACK',         // имя проекта, меняется только здесь
  ticker: '6PACK',
};

/* Кошелёк живёт отдельным файлом и до BRAND не дотягивается — кладём тикер
   в window сами. Раньше wallet.js читал `window.DimehoodBrand`, которого
   никто не выставлял, и молча показывал вписанное в него запасное имя:
   второй список того же самого, разошедшийся бы на первом переименовании. */
window.SixpackBrand = BRAND.ticker;

/* Где лежит этот файл.

   Нужно ровно для одного: догрузить stage.js. Динамический `import()` в
   обычном (не модульном) скрипте считает путь **от адреса страницы**, а не
   от адреса скрипта. Пока страница одна и лежит в корне, разницы нет; на
   странице в подпапке `./stage.js` превращается в `/подпапка/stage.js`,
   которого там нет, и фигура молча не заводится — вместо неё остаётся
   статический рисунок из разметки, а он выглядит как работающий.

   Ровно так и случилось на черновиках вариантов: сфера была на месте и не
   вращалась, и это было незаметно на скриншоте. Считаем от самого скрипта. */
const HERE = (document.currentScript && document.currentScript.src) || location.href;

/* Правила механики живут в core.js — одним набором чисел на весь проект:
   по ним считает калькулятор здесь, размер эпохи на сервере, и их же
   описывает словами /docs. Копия здесь означала бы два списка одного и
   того же; они разъезжаются на первом патче, и молча. */
const MODEL = globalThis.SixpackCore.MODEL;

/* Веса мест в базисных пунктах: [1667, 1667, 1667, 1667, 1666, 1666].
   Считаются ядром, а не переписываются сюда числами. */
const WEIGHTS = globalThis.SixpackCore.weightsBps();



let BASKET = [];
let DISP = null;
let SELF = null;   // наш токен: заполнится, как только будет адрес
let META = { source: null, scanned: 0, priced: 0, at: 0, failed: null, via: null, age: null };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* =========================================================================
   Форматирование
   ========================================================================= */

const nf = (v, d = 0) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Деньги. Никто не должен читать 249999.99999999997 — на MAOMAO читали. */
function money(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + nf(v / 1e9, 2) + 'B';
  if (a >= 1e6) return '$' + nf(v / 1e6, 2) + 'M';
  if (a >= 1e3) return '$' + nf(v, 0);
  if (a >= 1)   return '$' + nf(v, 2);
  if (a > 0)    return '$' + nf(v, 4);
  return '$0';
}

/** Цена: мелочь пишем счётчиком нулей, как на биржах и как в оригинале. */
function price(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1) return '$' + nf(v, 2);
  if (v >= 0.0001) return '$' + Number(v.toPrecision(4));
  const [m, e] = v.toExponential(4).split('e');
  const zeros = Math.abs(Number(e)) - 1;
  const digits = m.replace('.', '').replace(/0+$/, '').slice(0, 4);
  const sub = String(zeros).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
  return '$0.0' + sub + digits;
}

const pct = (v, d = 2) => (v >= 0 ? '+' : '') + nf(v, d) + '%';

function units(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return nf(v / 1e6, 2) + 'M';
  if (v >= 1e3) return nf(v / 1e3, 1) + 'K';
  if (v >= 1)   return nf(v, 2);
  // Хвостовые нули у дробей врут о точности: 0.29 — это 0.29, а не 0.2900.
  return String(Number(v.toPrecision(3)));
}

const esc = s => String(s ?? '').replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}

/* =========================================================================
   Производные
   ========================================================================= */
const totalLiq = () => BASKET.reduce((s, t) => s + t.liq, 0);
const totalVol = () => BASKET.reduce((s, t) => s + t.vol24, 0);

/** Вес участника — его доля ликвидности корзины. */
function weights() {
  const L = totalLiq();
  return L > 0 ? BASKET.map(t => t.liq / L) : BASKET.map(() => 1 / (BASKET.length || 1));
}

const NA = '—';


/* =========================================================================
   Фигура в стакане. Сам рендер живёт в stage.js и грузится отдельно —
   вместе с three.js это 670 КБ, и тянуть их в первый экран незачем.

   Порядок запуска взят у оригинала: ждём, пока стакан покажется на
   экране, затем первое движение посетителя — или восемь секунд тишины.
   ========================================================================= */
let stopStage = null;

/* База API для стакана: иконки токенов он тянет через нашу пересылку.
   Пусто — тот же домен, /api/* переписывается на Railway через vercel.json.
   Абсолютный адрес нужен только при открытии с file://, где домена нет. */
const API_BASE = (location.protocol === 'file:')
  ? 'https://api-production-2cac.up.railway.app'
  : '';

/* Состав корзины для упаковки.

   Стакан просыпается по первому движению посетителя, а корзина приходит
   своим чередом — и порядок этих двух событий не определён. Поэтому здесь
   промис, а не значение: если корзина уже есть, он готов сразу, если ещё
   нет — стакан подождёт её и не соберёт шесть безымянных банок. */
function basketReady() {
  if (BASKET && BASKET.length) return Promise.resolve(BASKET);
  return new Promise(resolve => {
    let left = 40;                       // 40 × 250 мс = десять секунд
    const tick = setInterval(() => {
      if (BASKET && BASKET.length) { clearInterval(tick); resolve(BASKET); }
      else if (--left <= 0) { clearInterval(tick); resolve(null); }
    }, 250);
  });
}

function wireStage() {
  const stage = $('.stage');
  const pre = $('pre.ascii');
  const fps = $('.stage .cn.tr');
  if (!stage || !pre || !fps) return;

  const WAKE = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  let timer = 0;

  const unwatch = () => {
    WAKE.forEach(ev => window.removeEventListener(ev, boot));
    clearTimeout(timer);
  };

  function boot() {
    unwatch();
    import(new URL('stage.js?v=6', HERE).href)
      .then(m => { stopStage = m.start(stage, pre, fps, basketReady(), API_BASE); })
      .catch(e => {
        console.error('фигура не загрузилась:', e);
        // Молчащего стакана быть не должно: пусть скажет, что случилось.
        fps.textContent = 'no render';
      });
  }

  const io = new IntersectionObserver(es => {
    if (!es.some(x => x.isIntersecting)) return;
    io.disconnect();
    WAKE.forEach(ev => window.addEventListener(ev, boot, { passive: true, once: true }));
    timer = window.setTimeout(boot, 8000);
  }, { rootMargin: '200px' });
  io.observe(stage);
}

/* =========================================================================
   Лента
   ========================================================================= */
function paintTape() {
  if (!BASKET.length) return;
  const html = BASKET.map(t =>
    '<span class="tk"><b>' + esc(t.sym) + '</b>' +
    '<span class="p">' + price(t.price) + '</span>' +
    '<span class="' + (t.chg24 >= 0 ? 'up' : 'dn') + '">' + pct(t.chg24) + '</span></span>'
  ).join('');
  /* Лента едет бесконечно только если одна её половина шире экрана.

     Приём такой: две одинаковые половины, лента уезжает ровно на 50% и
     возвращается — шва не видно, потому что на его месте оказывается
     копия. Но это работает, пока половина закрывает экран целиком. Когда
     мест стало шесть вместо десяти, половина сузилась почти вдвое, и на
     широком мониторе за её хвостом открывалась пустота: лента буквально
     «заканчивалась» и ехала дальше пустой.

     Поэтому список повторяется столько раз, сколько нужно, чтобы половина
     переросла экран. Считаем не на глаз: меряем ширину и дополняем, пока
     не хватит, с потолком на случай, если измерение вернёт ноль (скрытая
     вкладка отдаёт нулевые размеры, и цикл был бы вечным). */
  $$('.tape-half').forEach(h => { h.innerHTML = html; });
  padTape();
}

/**
 * Дополнить ленту до бесконечной.
 *
 * Приём с двумя половинами работает, только пока одна половина шире
 * экрана: лента уезжает ровно на 50% и возвращается, а на месте шва
 * оказывается копия. Когда мест стало шесть вместо десяти, половина
 * сузилась почти вдвое, и на широком мониторе за её хвостом открывалась
 * пустота — лента буквально заканчивалась и ехала дальше пустой.
 *
 * Вызывается дважды: сразу на загрузке, по разметке, и ещё раз после
 * прихода данных. Первый вызов важен не меньше второго: если цепь
 * отвечает медленно или не отвечит вовсе, человек всё это время смотрит
 * на короткую ленту, и «данных ещё нет» выглядит как «сайт сломан».
 */
function padTape() {
  const halves = $$('.tape-half');
  const first = halves[0];
  if (!first) return;
  const seed = halves.map(h => h.innerHTML);
  if (!seed[0]) return;

  /* Потолок обязателен: на скрытой вкладке и до загрузки шрифтов браузер
     отдаёт нулевые размеры, и цикл по замеру не остановился бы. */
  const need = Math.max(window.innerWidth, 1) * 1.2;
  for (let k = 0; k < 8 && first.scrollWidth > 0 && first.scrollWidth < need; k++) {
    halves.forEach((h, i) => { h.innerHTML += seed[i]; });
  }
}

/* =========================================================================
   Раздел 1 — сводка. Восемь карточек, заголовки и подписи — его, слово в
   слово. Все они про наш токен: капитализация, ликвидность его пула,
   его оборот, холдеры, выплаты. Токена нет — значит прочерк везде, кроме
   часов. У него самого так сделано с холдерами: «— / not indexed yet».
   ========================================================================= */
function paintSummary() {
  const k = $$('.kpi');
  if (k.length < 8) return;

  const set = (el, key, val, sub) => {
    if (!el) return;
    $('.k', el).textContent = key;
    const v = $('.v', el);
    v.textContent = val;
    v.removeAttribute('data-cu');       // счётчик оригинала нам не нужен
    $('.s', el).innerHTML = sub;
  };

  const S = SELF || {};
  const has = v => Number.isFinite(v) && v > 0;

  set(k[0], 'market cap', has(S.marketCap) ? money(S.marketCap) : NA,
      has(S.marketCap)
        ? '<b>' + nf(MODEL.supply) + '</b> supply, fully circulating'
        : 'no token deployed');

  set(k[1], 'liquidity', has(S.liq) ? money(S.liq) : NA,
      'across <b>' + (S.pools || '—') + '</b> pools');

  set(k[2], 'total volume', has(S.vol24) ? money(S.vol24) : NA,
      has(S.vol24) ? 'last 24h' : 'not trading yet');

  set(k[3], BRAND.name.toLowerCase() + ' holders',
      Number.isFinite(S.holders) ? nf(S.holders) : NA,
      Number.isFinite(S.holders) ? 'read from the explorer' : 'not indexed yet');

  const paid = (S.epochs || []).length;
  set(k[4], 'dividends paid out', NA,
      'across <b>' + (paid || '—') + '</b> epochs, in kind');
  set(k[5], 'last epoch paid', NA, '<b>—</b> per constituent, equal weight');
  set(k[6], 'eligible supply', NA, '<b>—</b> qualified at snapshot');

  // Часы идут по-настоящему, их ведёт tick(). Подпись его.
  $('.k', k[7]).textContent = 'next distribution';
  $('.s', k[7]).innerHTML =
    'checked every <b>three hours</b> · closes once the pot covers settlement';

  // Разброс за сутки живёт в корзине — считаем здесь, показываем там.
  const best = BASKET.length ? BASKET.reduce((a, b) => (b.chg24 > a.chg24 ? b : a)) : null;
  const worst = BASKET.length ? BASKET.reduce((a, b) => (b.chg24 < a.chg24 ? b : a)) : null;
  DISP = best ? { pts: nf(best.chg24 - worst.chg24, 0), best, worst } : null;
}

/* =========================================================================
   Раздел 2 — корзина. Слева у него — сколько роздано за девять эпох;
   у нас эпох нет, поэтому прочерк. Справа две метрики про сами пулы
   корзины: суточный оборот и разброс. Эти читаются из цепи и у него, и
   у нас — их и показываем живьём.
   ========================================================================= */
function paintBasket() {
  const big = $('.big-g');
  if (!big) return;

  const hdrs = $$('.hdr span', big);
  const nums = $$('.n-xxl, .n-xl, .n-l', big);
  const fns = $$('.fn', big);

  const rows = [
    ['distributed to holders', NA,
     'across <b>—</b> settled epochs · ' + MODEL.seats + ' constituents · <b>equal weight</b>, '
     + nf(100 / MODEL.seats, 1) + '% each'],
    ['eligible supply, last epoch', NA, '<b>—</b> of supply qualified at the snapshot'],
    ['24h basket volume', BASKET.length ? money(totalVol()) : NA, 'across all six pools'],
    ['dispersion, 24h', DISP ? DISP.pts + 'pts' : NA,
     DISP ? 'best <b>' + pct(DISP.best.chg24, 2) + '</b> · worst <b>' + pct(DISP.worst.chg24, 2) + '</b>'
          : 'reading chain…'],
  ];
  rows.forEach((r, i) => {
    if (hdrs[i]) hdrs[i].textContent = r[0];
    if (nums[i]) { nums[i].textContent = r[1]; nums[i].removeAttribute('data-cu'); }
    if (fns[i]) fns[i].innerHTML = r[2];
  });

  // Полоски «last epoch» и «all epochs»: эпох не было — пустые.
  $$('.bvm .lb').forEach((lb, i) => {
    lb.innerHTML = '<span>' + (i ? 'all epochs' : 'last epoch') + '</span><b>' + NA + '</b>';
    const trk = lb.parentElement.querySelector('.trk i');
    if (trk) { trk.style.width = '0%'; trk.removeAttribute('data-fill'); }
  });
}

/* =========================================================================
   Раздел 3 — калькулятор
   ========================================================================= */
const MIN_HOLD = 100_000, MAX_HOLD = 500_000_000;

/* Округление до «круглого»: одна значащая цифра, шаг 1 / 2.5 / 5.
   Человек, тянущий ползунок, ждёт 10 000 000, а не 9 970 000 — и
   некруглое число он читает как ошибку, а не как точность. */
function roundNice(v) {
  if (!Number.isFinite(v) || v <= 0) return MIN_HOLD;
  const mag = 10 ** Math.floor(Math.log10(v));
  const r = v / mag;
  const step = r < 1.5 ? 0.1 : r < 3 ? 0.25 : 0.5;
  return Math.round(v / (mag * step)) * (mag * step);
}

const s2a = s => {
  const lo = Math.log10(MIN_HOLD), hi = Math.log10(MAX_HOLD);
  const raw = 10 ** (lo + (hi - lo) * (s / 1000));
  return Math.min(Math.max(roundNice(raw), MIN_HOLD), MAX_HOLD);
};
const a2s = a => {
  const lo = Math.log10(MIN_HOLD), hi = Math.log10(MAX_HOLD);
  const c = Math.min(Math.max(a, MIN_HOLD), MAX_HOLD);
  return Math.round(((Math.log10(c) - lo) / (hi - lo)) * 1000);
};

/* Сколько монет сейчас в калькуляторе.

   Держим отдельно от положения ползунка, и это не лишняя переменная.
   Ползунок дискретный: тысяча шагов на логарифмической шкале. Нажатие на
   «1M» ставило положение, а показывалось то, что из этого положения
   вычиталось обратно, — 997 000 вместо миллиона. Точное значение теперь
   живёт здесь, а ползунок остаётся тем, чем и был: способом его менять. */
let HOLD = 19_650_000;

/** Задать количество извне: чип, баланс кошелька, что угодно. */
function setHold(amount, { moveSlider = true } = {}) {
  HOLD = Math.min(Math.max(Number(amount) || 0, 0), MAX_HOLD);
  const input = $('.calc input[type="range"]');
  if (input && moveSlider) input.value = a2s(HOLD);
  paintCalc();
}

function paintCalc() {
  const input = $('.calc input[type="range"]');
  if (!input) return;
  const amount = HOLD;
  /* Считает ядро — то же, что считает сервер, и то, что проверяется
     тестами. Здесь остаётся только показать. Пока формула жила в этой
     функции, подмена множителя в ней проходила мимо всех проверок. */
  const D = globalThis.SixpackCore.dividendFor(amount, SELF && SELF.vol24, SELF && SELF.price);

  /* Поле ввода не трогаем, пока в нём печатают: перезапись текста уводит
     каретку в конец, и набрать число длиннее двух цифр становится нельзя. */
  const field = $('.calc-amount');
  if (field && document.activeElement !== field) field.value = nf(amount);
  const unit = $('.calc-unit');
  if (unit) unit.textContent = BRAND.ticker;
  input.setAttribute('aria-valuetext', nf(amount) + ' ' + BRAND.ticker);

  const put = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  put('.cs-value', D.value ? money(D.value) : NA);
  put('.cs-share', nf(D.share * 100, 3) + '%');

  /* Три горизонта вместо одного. За эпоху — то, что платят; в сутки и за
     тридцать дней — то, о чём человек на самом деле спрашивает, когда
     смотрит на трёхчасовую выплату. Все три считает ядро. */
  put('.calc-big', D.mine === null ? NA : money(D.mine));
  put('.cs-day', D.perDay === null ? NA : money(D.perDay));
  put('.cs-30d', D.per30d === null ? NA : money(D.per30d));
  put('.cs-yield', D.yieldPerEpoch === null ? NA : nf(D.yieldPerEpoch * 100, 2) + '%');
  put('.cs-apr', D.yieldAnnual === null ? NA : nf(D.yieldAnnual * 100, 0) + '%');
  put('.calc-per', 'per epoch · every ' + MODEL.epochHours + 'h');

  const caveat = $('.caveat');
  if (caveat) {
    caveat.innerHTML = D.mine === null
      ? '<b>No token address is set,</b> so there is no volume to compute from. '
        + 'The moment the contract is live this fills in by itself.'
      : '<b>Model, not a record.</b> Computed from live 24h volume at the '
        + 'published rate: the pool charges ' + nf(MODEL.poolFeeBps / 100, 0)
        + '%, the venue keeps ' + nf(MODEL.venueShare * 100, 0)
        + '% of it, and the remaining ' + nf(MODEL.wedgeBps / 100, 1)
        + '% goes to holders in full, split six ways every ' + MODEL.epochHours
        + ' hours. Day and month figures assume this volume holds. '
        + 'No epoch has settled yet.';
  }

  /* Разбор по токенам: клин делится между шестью местами поровну — «equal
     weight», как в правилах. Количество монет считается по живой цене
     каждого участника. */
  const perSeat = D.perSeat;

  $$('.crow').forEach((row, i) => {
    const t = BASKET[i];
    if (!t) { row.hidden = true; return; }
    row.hidden = false;
    const name = $('span > b', row);
    if (name) name.textContent = t.sym;
    const q = $('.q', row), d = $('.d', row);
    if (q) q.textContent = perSeat === null ? NA : units(perSeat / t.price);
    if (d) d.textContent = perSeat === null ? NA : money(perSeat);
    setRowIcon(row, t);
  });
}

/* =========================================================================
   ШРИФТЫ И СТАРЫЕ ПЕРЕКЛЮЧАТЕЛИ

   Здесь жили пять переключателей: ?bg= для фактуры карточек, ?fig= для
   фигуры, ?render= для способа показа, ?type= и ?mono= для шрифтов. Они
   были нужны, пока решения принимались глазами на живой странице: спорить
   про фактуру в переписке бессмысленно, её надо увидеть.

   Решения приняты: фольга, упаковка из шести банок, Azeret Mono. Всё
   лишнее удалено — каждый неиспользуемый вариант это код, который надо не
   сломать при любой правке рядом, ради вида, который никто не увидит.

   ЗАЧЕМ СТИРАЮТСЯ КЛЮЧИ. Выбор запоминался в localStorage, и память эта
   переживает выкладку. У того, кто хоть раз открывал `?render=ascii`,
   браузер помнил «ascii» — и после удаления параметров он всё равно видел
   бы старую фигуру из символов вместо упаковки. Ровно это и случилось.
   Перестать читать ключи недостаточно, их надо убрать.
   ========================================================================= */
(function forgetOldChoices() {
  try {
    for (const k of ['sixpack.bg', 'sixpack.fig', 'sixpack.render',
                     'sixpack.type', 'sixpack.mono', 'sixpack.theme']) {
      localStorage.removeItem(k);
    }
  } catch (_) { /* приватный режим — там и хранить было негде */ }
})();

(function loadFonts() {
  /* preconnect до самой ссылки: без него браузер сначала резолвит домен и
     жмёт руку, и только потом узнаёт, что ему нужен шрифт. */
  for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    const l = document.createElement('link');
    l.rel = 'preconnect'; l.href = href;
    if (href.includes('gstatic')) l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@300;400;500&display=swap';
  document.head.appendChild(link);
})();

/**
 * Настоящая иконка токена в строке разбора под калькулятором.
 *
 * Строки читаются мини-карточками той же корзины, что и шесть больших
 * выше, — значит и монета в них должна быть та же, а не наш абстрактный
 * значок. Значок остаётся под картинкой и становится видимым сам, если
 * та не загрузилась.
 *
 * Две ловушки здесь ровно те же, что были на больших карточках, и обе
 * стоили по вечеру — поэтому повторены дословно, а не «по памяти»:
 *
 *   1. Ключ перерисовки — символ И адрес картинки. По одному символу
 *      строка запоминала «нарисован» на первом чтении, где иконок ещё не
 *      было, и следующее чтение — уже с иконкой — пропускала.
 *   2. Никакого loading="lazy". Картинка создаётся вне документа и
 *      попадает в него только после onload; ленивая не грузится, пока не
 *      окажется в документе, то есть не грузится никогда. Событие не
 *      приходит вовсе — ни onload, ни onerror, и в консоли пусто.
 */
/* =========================================================================
   ТОН ТОКЕНА

   Окно с иконкой на карточке красится в цвет самого токена, уведённый в
   тень. Цвет нигде не хранится и не может быть вписан руками: состав
   корзины меняется каждые три часа, и список из шести цветов устарел бы в
   тот же день. Значит его надо ИЗМЕРИТЬ по самой иконке.

   ГЛАВНОЕ ПРАВИЛО: цвет засчитывается, только если его в иконке МНОГО.

   Первая версия брала самый насыщенный оттенок, и на CASHCAT это дало
   коричневый — при том что иконка почти целиком белая. Замер объясняет,
   почему: цветных точек там 11.5% при насыщенности 0.17, то есть весь
   «цвет» это шерсть и тени на белом фото. Для сравнения у STONKBROKER
   цветных 54% при насыщенности 1.00, у DOGO — 25% при 0.90.

   Поэтому решает произведение доли на насыщенность:
     STONKBROKER 0.54 × 1.00 = 0.54     AI      0.73 × 0.34 = 0.25
     DOGO        0.25 × 0.90 = 0.23     PIPEDOG 0.23 × 0.39 = 0.09
     CASHCAT     0.12 × 0.17 = 0.02     PONS    0.00        = 0.00
   Порог 0.05 отсекает CASHCAT и PONS и оставляет PIPEDOG, у которого
   коричневый честный — это шерсть собаки во всю иконку. Между CASHCAT и
   PIPEDOG почти пятикратный зазор, так что порог не на грани.

   КАК СЧИТАЕТСЯ ОТТЕНОК. Иконка уменьшается до 32×32. Отбрасываются точки,
   которые о цвете врут: почти серые (размах каналов меньше 0.12), почти
   чёрные и почти белые — их «оттенок» это шум сжатия, — и прозрачные.
   Оставшиеся раскладываются по двадцати четырём корзинам оттенка с весом
   по насыщенности, а внутри победившей корзины оттенок усредняется ПО
   КРУГУ, через синус и косинус: обычное среднее между 350° и 10° дало бы
   180°, то есть из красного получилась бы бирюза.

   Насыщенность результата тоже берётся из замера, а не задаётся: слабый
   цвет должен выйти приглушённым, иначе бледная иконка получит такое же
   яркое окно, как STONKBROKER.

   Иконка обязана идти через наш /api/icon: чужой CDN не отдаёт CORS, и
   getImageData на испорченном холсте бросает исключение вместо цвета.
   ========================================================================= */
const TONES = new Map();

/* Порог «цвета в иконке достаточно». Выведен из замера шести иконок
   корзины, см. таблицу выше. */
const TONE_MIN = 0.05;

/* Нейтральный тон записан переменными темы, а не числами: тем пятнадцать,
   и серое окно обязано быть серым в тон текущей. */
const NEUTRAL_TONE = {
  base: 'color-mix(in srgb, var(--color-block-2) 62%, #000)',
  hi:   'color-mix(in srgb, var(--color-block) 70%, transparent)',
};

function dominantTone(img) {
  const N = 32;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return NEUTRAL_TONE;

  let px;
  try {
    g.drawImage(img, 0, 0, N, N);
    px = g.getImageData(0, 0, N, N).data;
  } catch (_) {
    return NEUTRAL_TONE;               // холст испорчен — хотя бы ровный тон
  }

  const BINS = 24;
  const w = new Float64Array(BINS), hx = new Float64Array(BINS), hy = new Float64Array(BINS);
  const sats = [];
  let opaque = 0;

  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < .5) continue;
    opaque++;

    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
    if (d < .12) continue;                       // серое
    const l = (mx + mn) / 2;
    if (l < .06 || l > .96) continue;            // почти чёрное и почти белое

    const s = d / (1 - Math.abs(2 * l - 1));
    sats.push(s);

    let hh;
    if (mx === r) hh = ((gg - b) / d + 6) % 6;
    else if (mx === gg) hh = (b - r) / d + 2;
    else hh = (r - gg) / d + 4;
    hh *= 60;

    const k = Math.floor(hh / (360 / BINS)) % BINS;
    w[k] += s;
    hx[k] += Math.cos(hh * Math.PI / 180) * s;
    hy[k] += Math.sin(hh * Math.PI / 180) * s;
  }

  if (!opaque || !sats.length) return NEUTRAL_TONE;

  /* Медиана, а не среднее: одна ярко-красная точка на белом фото сдвинула
     бы среднее заметно, медиану — нет. */
  sats.sort((a, b) => a - b);
  const medS = sats[sats.length >> 1];
  const share = sats.length / opaque;
  if (share * medS < TONE_MIN) return NEUTRAL_TONE;

  let best = 0;
  for (let k = 1; k < BINS; k++) if (w[k] > w[best]) best = k;
  const hue = (Math.atan2(hy[best], hx[best]) * 180 / Math.PI + 360) % 360;
  const sat = Math.round(Math.min(70, Math.max(14, medS * 90)));

  /* Светлота задана здесь, а не взята у иконки. Карточка тёмная, и окно
     обязано остаться тёмным независимо от того, насколько ярок токен:
     иначе рядом с чёрной карточкой висел бы светящийся прямоугольник. */
  return {
    base: `hsl(${hue.toFixed(0)} ${sat}% 9%)`,
    hi:   `hsl(${hue.toFixed(0)} ${Math.min(78, sat + 8)}% 21%)`,
  };
}

function tokenTone(url) {
  if (!url) return Promise.resolve(null);
  if (TONES.has(url)) return TONES.get(url);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(dominantTone(img));
    img.onerror = () => resolve(null);
    img.src = API_BASE + '/api/icon?u=' + encodeURIComponent(url);
  });
  TONES.set(url, p);
  return p;
}

function setRowIcon(row, t) {
  const host = $('.sv', row);
  if (!host) return;
  if (host.dataset.sym === t.sym && host.dataset.icon === (t.icon || '')) return;
  host.dataset.sym = t.sym;
  host.dataset.icon = t.icon || '';
  host.classList.remove('has-icon');
  const old = $('img', host);
  if (old) old.remove();
  if (!t.icon) return;

  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => { host.classList.add('has-icon'); host.appendChild(img); };
  img.onerror = () => { /* остаётся наш знак */ };
  img.src = t.icon;
}

function wireCalc() {
  const input = $('.calc input[type="range"]');
  if (!input) return;

  /* Ввод руками. Ползунок логарифмический и округляет до круглого — им
     нельзя набрать «19 650 000», а именно столько монет у человека и
     лежит. Пока поля не было, единственным способом задать своё число
     оставались четыре пресета. */
  const field = $('.calc-amount');
  if (field) {
    const read = () => {
      const raw = field.value.replace(/[^\d]/g, '');
      const n = Number(raw || 0);
      HOLD = Math.min(Math.max(n, 0), MAX_HOLD);
      input.value = a2s(HOLD);
      paintCalc();
    };
    field.addEventListener('input', read);
    /* На уходе из поля дорисовываем разделители и подтягиваем к границам:
       правку показываем сразу, а не молча меняем число под пальцами. */
    field.addEventListener('blur', () => {
      HOLD = Math.min(Math.max(HOLD, 0), MAX_HOLD);
      field.value = nf(HOLD);
      paintCalc();
    });
    field.addEventListener('keydown', e => { if (e.key === 'Enter') field.blur(); });
  }
  /* Ползунок — источник значения только когда его тянут. Всё остальное
     время значение точное и приходит извне. */
  input.addEventListener('input', () => { HOLD = s2a(Number(input.value)); paintCalc(); });
  const map = [1e6, 1e7, 5e7, 2.5e8];
  $$('.chip').forEach((chip, i) => {
    chip.addEventListener('click', () => {
      setHold(map[i]);
      $$('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
    });
  });
}

/* =========================================================================
   Раздел 4 — карточки корзины
   ========================================================================= */

/** Спарклайн из того, что реально известно: изменения за 5м, 1ч, 6ч, 24ч. */
function sparkPoints(t) {
  const past = [t.chg24, t.chg6, t.chg1, t.chg5, 0];
  const vals = past.map(c => 1 / (1 + (c || 0) / 100));   // цена относительно текущей
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  return vals.map((v, i) =>
    (i * (100 / (vals.length - 1))).toFixed(1) + ',' +
    (35 - ((v - min) / span) * 30).toFixed(1)
  ).join(' ');
}

function paintBasketCards() {
  const cards = $$('.tc');
  const w = weights();
  cards.forEach((card, i) => {
    const t = BASKET[i];
    /* Место без данных не прячем. Спрятанная карточка читается как «их
       пять» — на сайте, у которого шестёрка в названии, это первое, что
       заметит человек, и он будет прав: пропало не оформление, пропала
       позиция корзины. Место остаётся и говорит, что читается. */
    if (!t) {
      card.hidden = false;
      card.classList.add('waiting');
      const bw = $('.tc-top b', card);
      if (bw) bw.textContent = '—';
      const nw = $('.nm', card);
      if (nw) nw.textContent = 'reading chain…';
      const pw = $('.pr', card);
      if (pw) pw.textContent = NA;
      const rkw = $('.rk', card);
      if (rkw) rkw.innerHTML = String(i + 1).padStart(2, '0') + '<b>/' + MODEL.seats + '</b>';
      card.onclick = null;
      card.style.cursor = 'default';
      return;
    }
    card.hidden = false;
    card.classList.remove('waiting');

    const b = $('.tc-top b', card);
    if (b) b.textContent = t.sym;
    /* Номер со знаменателем: «01» само по себе не говорит, из скольких.
       Знаменатель берётся из модели, а не вписан шестёркой — вписанное
       число пережило бы смену размера корзины и соврало бы молча. */
    const rk = $('.rk', card);
    if (rk) rk.innerHTML = String(i + 1).padStart(2, '0') + '<b>/' + MODEL.seats + '</b>';
    const nm = $('.nm', card);
    if (nm) nm.textContent = t.name;
    const pr = $('.pr', card);
    if (pr) pr.textContent = price(t.price);

    const ch = $('.ch span:first-child', card);
    if (ch) {
      ch.className = t.chg24 >= 0 ? 'up' : 'dn';
      ch.textContent = (t.chg24 >= 0 ? '▲ ' : '▼ ') + pct(t.chg24);
    }
    /* Арт карточки — настоящая иконка токена, а не наш абстрактный значок.
       Именно она делает из строки таблицы карточку: у карточки должен быть
       предмет, который узнают.

       Иконки живут на чужих CDN (DexScreener и CoinGecko через обозреватель),
       и на любую из них надо смотреть как на ту, что не загрузится: домен
       ляжет, картинку удалят, у нового участника корзины её не окажется
       вовсе. Поэтому под картинкой всегда лежит наш знак, и он же остаётся
       один, если onerror сработал. Пустая рамка вместо арта выглядит как
       поломка вёрстки, а не как «иконки нет». */
    let art = $('.tc-art', card);
    if (!art) {
      art = document.createElement('span');
      art.className = 'tc-art';
      art.setAttribute('aria-hidden', 'true');
      card.insertBefore(art, card.firstChild);
    }
    /* Сравниваем и символ, и адрес иконки. Сначала было только по символу,
       и иконки не появлялись вовсе: первое чтение приходило из базы, где
       записи были сделаны до того, как иконки вообще начали собираться.
       Карточка запоминала «PIPEDOG нарисован» и на следующем чтении — уже
       с иконкой — решала, что перерисовывать нечего. Данные пришли позже,
       чем отрисовка решила, что она закончила. */
    if (art.dataset.sym !== t.sym || art.dataset.icon !== (t.icon || '')) {
      art.dataset.sym = t.sym;
      art.dataset.icon = t.icon || '';
      art.classList.remove('has-icon');
      const mark = $('.tc-top .sv svg', card);
      art.innerHTML = '<span class="tc-art-in">' + (mark ? mark.outerHTML : '') + '</span>';
      if (t.icon) {
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        /* Без loading="lazy", и это не забывчивость.

           Картинка создаётся вне документа и попадает в него только после
           onload. Браузер откладывает загрузку ленивых изображений до тех
           пор, пока они не окажутся в разметке рядом с областью просмотра,
           — а эта не окажется там никогда, потому что ждёт собственного
           onload. Замер: с lazy событие не приходит вообще, ни onload, ни
           onerror, и карточка вечно стоит со знаком вместо иконки.

           Ни ошибки, ни следа в консоли: выглядит ровно как «иконки нет». */
        /* Показываем только после успешной загрузки: подставленный сразу
           <img> со сломанной ссылкой рисует иконку битой картинки поверх
           нашего знака — хуже, чем не показать ничего. */
        img.onload = () => { art.classList.add('has-icon'); art.appendChild(img); };
        img.onerror = () => { /* остаётся знак */ };
        img.src = t.icon;

        /* Тон окна — измеренный цвет самой иконки. Проверка dataset перед
           применением обязательна: корзина перечитывается каждую минуту, и
           к моменту, когда цвет посчитан, в этой карточке может стоять уже
           другой токен. Тогда он получил бы чужой цвет. */
        const want = t.icon;
        tokenTone(want).then(tone => {
          if (!tone || art.dataset.icon !== want) return;
          card.style.setProperty('--tone', tone.base);
          card.style.setProperty('--tone-hi', tone.hi);
          card.classList.add('has-tone');
        });
      } else {
        card.classList.remove('has-tone');
      }
    }

    const poly = $('.spark polyline', card);
    if (poly) poly.setAttribute('points', sparkPoints(t));

    /* Вес равный — это правило корзины, а не замер. Число берётся из
       weightsBps: шесть мест на десять тысяч базисных пунктов не делятся,
       и верхние места получают на пункт больше. Вписать «16.67%» руками
       значило бы соврать на четырёх сотых и разойтись с контрактом. */
    const bar = $('.wbar .t i', card);
    if (bar) bar.style.width = (w[i] * 100).toFixed(1) + '%';
    const em = $('.wbar + em, .tc-foot em', card);
    if (em) em.textContent = nf(WEIGHTS[i] / 100, 2) + '%';
    /* В подвале — ликвидность пула, то есть ровно то, за что место и
       дано. Раньше здесь стоял прочерк на месте «сколько куплено»:
       честно, но бесполезно — куплено не будет ничего до первой эпохи,
       а место в корзине заслужено уже сейчас, и видно это по глубине. */
    const val = $('.val', card);
    if (val) val.textContent = t.liq > 0 ? money(t.liq) : NA;

    // Карточка ведёт в обозреватель: адрес можно проверить, не веря странице.
    card.style.cursor = 'pointer';
    card.onclick = () => window.open(t.url, '_blank', 'noopener');
    card.title = t.address;
  });

  const foot = $('.tc-foot-note') || null;
  if (foot) foot.textContent = 'scanned ' + META.scanned + ' tokens · ' + META.priced + ' priced';
}

/* =========================================================================
   Раздел 5 — реестр. Выплат не было, поэтому строк нет и придумывать их
   нельзя. Пустое состояние говорит, почему пусто.
   ========================================================================= */
/**
 * Подписи в подвалах секций. В оригинале там стоят его итоги — «total cost
 * $312,880», «5 epochs», «paid in kind … total $128,470». Ни одного из этих
 * чисел у нас нет, и оставить их значило бы обещать больше, чем умеет код.
 */
function paintFootlines() {
  /* Его подписи не переписываем — они часть вёрстки. Меняются только
     места с его числами: там, где у него деньги закрытых эпох, у нас
     прочерк. Сравниваем по тексту целиком: подписи набраны с <b> внутри,
     и фильтр по узлам без детей их пропускал — три числа так и стояли
     внизу калькулятора, корзины и реестра. */
  const swap = (re, text) => {
    $$('.corners span, .mid, .ann, .fn, .btm span').forEach(el => {
      if (el.closest('.prev') || $('.src', el)) return;
      if (re.test(el.textContent.trim())) el.innerHTML = text;
    });
  };
  const spot = SELF && SELF.price;
  swap(/^supply [\d,]+ · spot .*/i,
       'supply <b>' + nf(MODEL.supply) + '</b> · spot <b>' +
       (spot ? price(spot) : '—') + '</b>');
  swap(/^last epoch bought .*/i, 'last epoch bought <b>—</b> · <b>—</b> per seat');
  swap(/^total \$[\d,]+$/i, 'total <b>—</b>');
  swap(/^constituents · as of.*/i,
       'constituents · as of ' + new Date().toISOString().slice(0, 10));
  swap(/^\d+ epochs?$/i, '— epochs');
}

function paintLedger() {
  const rows = $$('.lr');
  if (!rows.length) return;
  const head = rows[0];                       // шапка таблицы
  rows.slice(1).forEach(r => r.remove());
  head.insertAdjacentHTML('afterend',
    '<div class="ledger-empty"><b>No epochs yet.</b> ' +
    'Nothing has been paid, so there is nothing to file. The first row appears ' +
    'once the vault takes its first fee — and it will be a transaction hash on ' +
    'Robinhood Chain, not a number typed into this page.</div>');
  head.remove();                              // шапка без строк читается как поломка

  const ann = $$('.ann').find(el => /epochs?$/i.test(el.textContent.trim()));
  if (ann) ann.textContent = 'none yet';
}

/* =========================================================================
   Часы эпохи. Считаются от настоящего UTC, а не от переменной, которую
   забудут перевести.
   ========================================================================= */
function tick() {
  const k = $$('.kpi')[7];   // восьмая карточка, последняя в двух рядах
  if (!k) return;
  const now = new Date();
  const ms = MODEL.epochHours * 3600 * 1000;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const left = ms - ((now.getTime() - start) % ms);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('.v', k).textContent = [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/* =========================================================================
   Состояние источника — вслух, а не в консоли
   ========================================================================= */
function paintStatus() {
  let box = $('.src');
  if (!box) {
    box = document.createElement('span');
    box.className = 'src';
    box.innerHTML = '<i class="dot"></i><span class="txt"></span>';
    /* В углу стакана у оригинала стоит «index · rotating» — не занимаем
       его. Метка источника живёт в шильдике у заголовка первой секции,
       рядом с его надписью, а не вместо неё: чистить чужой узел значит
       стирать то, ради чего копировали вёрстку. */
    const host = $('.prev') || $('.corners');
    if (host) host.appendChild(box); else document.body.appendChild(box);
  }
  const txt = $('.txt', box);
  if (META.failed) {
    box.className = 'src bad';
    txt.textContent = '· chain did not answer';
    return;
  }
  if (!BASKET.length) { box.className = 'src'; txt.textContent = '· reading…'; return; }
  box.className = 'src ok';
  const bits = [];
  if (META.source === 'fallback') bits.push('partial list');
  /* Кто сходил за данными — часть правды о них. Когда сервис недоступен,
     страница читает цепь сама: работает так же, но чужие бесплатные API
     падают чаще, и «partial list» тогда — не случайность, а следствие.
     Молчать об этом значит выдавать одно за другое. */
  if (META.via === 'direct') bits.push('read in-browser');
  /* Возраст показываем серверный: если сборщик застрял, «2s ago» по часам
     браузера соврало бы про свежесть — обновилась страница, а не данные. */
  const seenMs = Number.isFinite(META.age) ? Date.now() - META.age : META.at;
  bits.push(ago(seenMs));
  txt.textContent = '· ' + bits.join(' · ');
}

/* =========================================================================
   Ссылки на X и GitHub. Аккаунтов ещё нет, поэтому кнопки честно об этом
   говорят вместо того, чтобы вести в никуда. Появятся адреса — вписать в
   SOCIAL, и кнопки станут обычными ссылками, ничего больше менять не надо.
   ========================================================================= */
const SOCIAL = {
  x: '',        // https://x.com/…
  github: 'https://github.com/sixpack-index/6pack',
};

function wireSocial() {
  $$('.soc').forEach(el => {
    const key = el.dataset.soc;
    const href = SOCIAL[key];
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; return; }
    el.classList.add('soon');
    el.addEventListener('click', e => {
      e.preventDefault();
      /* У кнопки-иконки подменять текст нечем — у неё его нет. Поэтому
         «скоро» говорим подсказкой и коротким миганием рамки, а не
         подстановкой строки: молча кнопка вести себя не должна. */
      const icon = !el.textContent.trim();
      if (icon) {
        const was = el.getAttribute('title');
        el.setAttribute('title', 'link goes live at launch');
        el.classList.add('blink');
        setTimeout(() => { el.classList.remove('blink'); if (was) el.setAttribute('title', was); }, 1400);
        return;
      }
      const prev = el.textContent;
      el.textContent = 'SOON';
      setTimeout(() => { el.textContent = prev; }, 1400);
    });
  });
}

/* Кошелёк живёт в wallet.js: подключение, сеть, балансы. Здесь только
   передаём ему кнопку. Раньше она честно отвечала «NO CONTRACT YET» —
   это было правдой, пока подключаться было не к чему, но сеть и газ
   существуют и без нашего токена, и посмотреть их полезно уже сейчас. */
function wireConnect() {
  if (window.SixpackWallet) {
    window.SixpackWallet.wire();
    window.SixpackWallet.restore();
  }
}

/* Кошелёк подставляет сюда настоящий баланс — один раз, дальше человек
   двигает ползунок сам. Наружу отдаём функцию, а не сам ползунок: пусть
   правило «как число превращается в позицию» остаётся в одном месте. */
window.SixpackCalc = function (amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  /* Баланс кошелька подставляется как есть, без округления: это его
     настоящее число, и подменять его «красивым» нельзя. */
  setHold(Math.min(amount, MODEL.supply));
  $$('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
};

/* Адрес контракта под заголовком: то, что первым делом ищут, придя с
   биржи или из ленты. Появляется вместе с адресом и исчезает без него —
   пустая строка «contract: —» не помогает никому.

   Кнопка копирования обязана отвечать нажатию. На loothood такая же
   кнопка прожила месяц, выглядя безупречно и не копируя ничего: ошибку
   никто не видел, потому что она молчала. */
function paintContract() {
  const box = $('.ca');
  if (!box) return;
  const token = window.SixpackChain.launchAddress('token');
  if (!token) { box.hidden = true; return; }
  box.hidden = false;
  const v = $('.ca-v', box);
  const scan = $('.ca-scan', box);
  if (v) v.textContent = token;
  if (scan) scan.href = window.SixpackChain.CHAIN.explorer + '/token/' + token;
}

function wireContract() {
  const btn = $('.ca-copy');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const token = window.SixpackChain.launchAddress('token');
    if (!token) return;
    const say = (text, ok) => {
      const prev = btn.textContent;
      btn.textContent = text;
      btn.classList.toggle('bad', !ok);
      setTimeout(() => { btn.textContent = prev; btn.classList.remove('bad'); }, 1400);
    };
    try {
      await navigator.clipboard.writeText(token);
      say('copied', true);
    } catch (_) {
      /* Буфер закрыт — например, страница открыта не по https. Тогда
         выделяем текст, чтобы человек скопировал сам, а не гадал. */
      const v = $('.ca-v');
      if (v) {
        const r = document.createRange();
        r.selectNodeContents(v);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        say('select+C', false);
      } else say('copy failed', false);
    }
  });
}

/* Ссылка на покупку. Появляется только когда адрес токена известен: кнопка
   «купить», ведущая в никуда, хуже отсутствующей — на прошлом проекте
   такая отправила покупателя на 404. */
function paintBuy() {
  const token = window.SixpackChain.launchAddress('token');
  const url = window.SixpackChain.buyLink();
  let a = $('.acts .btn.buy');
  /* Нет адреса токена или нет ссылки — нет и кнопки.

     Ссылка теперь появляется сама: как только у токена есть пул, chain.js
     складывает адрес его страницы на витрине. Раньше кнопки не было, пока
     ссылку не впишут в консоль руками, и это ставило запуск в зависимость
     от того, вспомнит ли об этом живой человек в первые минуты.

     Пусто здесь остаётся только до запуска — когда пула ещё нет. */
  if (!token || !url) { if (a) a.remove(); return; }
  if (!a) {
    a = document.createElement('a');
    a.className = 'btn f buy';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Buy $' + BRAND.ticker;
    const acts = $('.acts');
    if (acts) acts.insertBefore(a, acts.firstChild);
  }
  a.href = url;
}

/* =========================================================================
   Сборка
   ========================================================================= */
function paintAll() {
  paintTape();
  paintSummary();
  paintBasket();
  paintBasketCards();
  paintCalc();
  paintFootlines();
  paintBuy();
  paintContract();
  paintStatus();
}

async function load() {
  /* Свой токен читается отдельно и молча: пока адреса нет, вернётся объект
     с нулями, и страница покажет прочерки. Впишешь адрес — те же поля
     заполнятся из цепи, ничего больше править не нужно. */
  window.SixpackChain.readLaunch(part => { SELF = part; paintAll(); })
    .then(s => { SELF = s; paintAll(); })
    .catch(e => console.warn('свой токен не прочитался:', e));

  try {
    const d = await window.SixpackChain.readChain();
    BASKET = d.basket;
    META = { source: d.source, scanned: d.scanned, priced: d.priced, at: d.at, failed: null, via: d.via, age: d.age };
    if (!BASKET.length) throw new Error('the basket came back empty');
  } catch (e) {
    console.error('чтение цепи не удалось:', e);
    META.failed = e.message || 'unknown error';
  }
  paintAll();
}

document.querySelectorAll('[data-brand-name]').forEach(el => { el.textContent = BRAND.name; });
/* Лента дополняется сразу, по разметке, не дожидаясь цепи: пока данных
   нет, человек всё равно смотрит на ленту, и короткая читается как
   поломка, а не как «ещё грузится». */
padTape();
window.addEventListener('resize', padTape, { passive: true });
wireStage();
wireCalc();
setHold(HOLD);
wireConnect();
wireSocial();
wireContract();
paintLedger();
paintCalc();
paintStatus();
tick();
setInterval(tick, 1000);
setInterval(() => { if (BASKET.length) paintStatus(); }, 15000);
load();
