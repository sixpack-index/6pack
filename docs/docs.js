/* =========================================================================
   Страница документации. Ей нужно немного: помнить выбранный акцент,
   вести оглавление и не молчать в ответ на кнопку кошелька.
   ========================================================================= */

const BRAND = { name: '6PACK', ticker: '6PACK' };

/* Тема выбрана на главной и лежит в localStorage — здесь её только читаем.
   Иначе документация открывалась бы в другом цвете, чем сайт. */
try {
} catch (_) { /* приватный режим */ }

/* Оглавление подсвечивает раздел, который сейчас на экране. */
const links = [...document.querySelectorAll('.docs-toc a')];
const targets = links
  .map(a => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

if (targets.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const i = targets.indexOf(e.target);
      links.forEach((a, k) => a.classList.toggle('on', k === i));
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  targets.forEach(t => io.observe(t));
}

/* Никаких молчащих кнопок: подключать нечего — так и говорим. */
const connect = document.querySelector('.connect');
if (connect) {
  connect.addEventListener('click', e => {
    e.preventDefault();
    const prev = connect.innerHTML;
    connect.innerHTML = '<i aria-hidden="true"></i>NO CONTRACT YET';
    setTimeout(() => { connect.innerHTML = prev; }, 1800);
  });
}


/* Кнопка кошелька есть и здесь: человек, читающий правила, чаще всего
   следующим шагом хочет проверить свой баланс. Отдельной логики не надо —
   вся она в wallet.js. */
if (window.SixpackWallet) {
  window.SixpackWallet.wire();
  window.SixpackWallet.restore();
}
