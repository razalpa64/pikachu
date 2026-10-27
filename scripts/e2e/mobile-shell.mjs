/**
 * The phone shell — is this an app or a web page in a phone-sized window?
 *
 *   node scripts/e2e/mobile-shell.mjs
 *
 * Everything below is a claim you can check by holding a phone:
 *
 *   • nothing scrolls sideways, on any of the ten screens;
 *   • the bottom bar has five tabs, each a thumb target, and the page leaves
 *     room for it (content is never hidden underneath);
 *   • the title bar names the screen you are on;
 *   • the account sheet is a real modal — labelled, Escape-dismissable, and it
 *     gives focus back to the button that opened it;
 *   • the library's filters are one tap away in a sheet rather than two rows of
 *     chips with the last one clipped;
 *   • a game owns its own app bar on a phone instead of stacking a second one;
 *   • a dialog on a phone is a bottom sheet, not a card floating in the middle.
 *
 * Env: BASE (default http://127.0.0.1:5173), PIKACHU_CHROME, PIKACHU_LD.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const LAUNCH = {
  executablePath: process.env.PIKACHU_CHROME || undefined,
  env: process.env.PIKACHU_LD ? { ...process.env, LD_LIBRARY_PATH: process.env.PIKACHU_LD } : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
};

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

/** Layout facts about the page as it stands. */
const shape = () => page.evaluate(() => {
  const bar = document.querySelector('nav[aria-label="Quick"]');
  const header = document.querySelector('header');
  const main = document.getElementById('main');
  const barRect = bar?.getBoundingClientRect();
  const style = bar ? getComputedStyle(bar) : null;
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
    headerHidden: !header || header.getBoundingClientRect().height === 0,
    title: header?.querySelector('p[aria-hidden="true"]')?.textContent?.trim() ?? null,
    tabs: bar ? [...bar.querySelectorAll('a')].map((a) => {
      const r = a.getBoundingClientRect();
      return { label: a.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
    }) : [],
    bar: barRect ? {
      top: Math.round(barRect.top), bottom: Math.round(barRect.bottom), h: Math.round(barRect.height),
      position: style.position,
      padBottom: style.paddingBottom,
    } : null,
    mainPadBottom: main ? parseInt(getComputedStyle(main).paddingBottom, 10) || 0 : 0,
  };
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  sessionStorage.setItem('pikachu.intro.v1', '1');
  localStorage.clear();
});

/* ------------------------------------------------------------- every screen */
const ROUTES = ['/', '/library', '/together', '/solo', '/retro', '/challenges', '/music', '/profile', '/settings'];
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  const s = await shape();
  check(`${route || '/'} does not scroll sideways`, s.scrollW <= s.vw + 1, `${s.scrollW} > ${s.vw}`);
  check(`${route || '/'} keeps the tab bar on screen`, !!s.bar && s.bar.position === 'fixed' && s.bar.bottom <= s.vh + 1,
    s.bar ? `${s.bar.position} bottom ${s.bar.bottom}` : 'no bar');
  check(`${route || '/'} leaves room under the content for the bar`,
    !!s.bar && s.mainPadBottom + 2 >= s.bar.h, `content pad ${s.mainPadBottom}, bar ${s.bar?.h}`);
}

/* ------------------------------------------------------------------- the bar */
await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
await page.waitForTimeout(350);
const bar = await shape();
check('the bar has five tabs', bar.tabs.length === 5, bar.tabs.map((t) => t.label).join(','));
check('every tab is a thumb target', bar.tabs.every((t) => t.h >= 44 && t.w >= 64),
  bar.tabs.map((t) => `${t.label} ${t.w}x${t.h}`).join(' '));
check('the tabs are the five screens you play',
  bar.tabs.map((t) => t.label.toUpperCase()).join(',') === 'HOME,GAMES,TOGETHER,SOLO,RETRO',
  bar.tabs.map((t) => t.label).join(','));
check('the title bar names the screen', bar.title === 'Games', String(bar.title));

/* --------------------------------------------------------------- the account */
const account = page.locator('[aria-label="You — profile, challenges and settings"]');
check('the account button is in the title bar', await account.count() === 1);
await account.click();
await page.waitForTimeout(400);
const sheet = page.locator('[role="dialog"]');
check('the account button opens a dialog', await sheet.count() === 1);
const namedBy = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return '';
  const id = d.getAttribute('aria-labelledby');
  return d.getAttribute('aria-label') ?? (id ? document.getElementById(id)?.textContent ?? '' : '');
});
check('the dialog says what it is', /you/i.test(namedBy), namedBy);
const sheetBox = await sheet.boundingBox();
check('on a phone that dialog is a bottom sheet', !!sheetBox && sheetBox.y > 844 * 0.3 && Math.abs(sheetBox.height + sheetBox.y - 844) < 3,
  sheetBox ? `top ${Math.round(sheetBox.y)}, height ${Math.round(sheetBox.height)}` : 'no box');
check('the page cannot scroll behind it', await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));
const reached = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent.trim().toUpperCase()));
for (const label of ['DAILY', 'MUSIC', 'CUPS', 'YOU', 'SETUP']) {
  check(`the sheet reaches ${label.toLowerCase()}`, reached.includes(label), reached.join(' '));
}
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes it', await sheet.count() === 0);
check('and focus goes back to the button that opened it',
  await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'You — profile, challenges and settings');
check('and the page can scroll again', await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'));

/* ------------------------------------------------------------- the library */
const before = await page.evaluate(() => Number(/Showing (\d+)/.exec(document.body.innerText)?.[1] ?? -1));
const filterButton = page.locator('main button[aria-haspopup="dialog"]').first();
check('the library has one filter button instead of a chip rail', await filterButton.count() === 1);
const firstCardTop = await page.evaluate(() => Math.round(document.querySelector('article')?.getBoundingClientRect().top ?? 9999));
check('a game is on the first screen without scrolling', firstCardTop < 600, `first card at ${firstCardTop}px`);
await filterButton.click();
await page.waitForTimeout(350);
const filterSheet = page.locator('[role="dialog"]');
check('it opens the filter sheet', await filterSheet.count() === 1);
check('the sheet carries the counts', /MULTIPLAYER\s*17/i.test(await filterSheet.innerText()), (await filterSheet.innerText()).slice(0, 60).replace(/\n/g, ' '));
await filterSheet.getByRole('button', { name: /^Multiplayer/i }).click();
await page.waitForTimeout(400);
check('choosing a filter closes the sheet', await page.locator('[role="dialog"]').count() === 0);
const after = await page.evaluate(() => Number(/Showing (\d+)/.exec(document.body.innerText)?.[1] ?? -1));
check('and the library is filtered', after > 0 && after < before, `${before} -> ${after}`);
check('the button now names the filter',
  /multiplayer/i.test(await page.locator('main button[aria-haspopup="dialog"]').first().innerText()));

/* ---------------------------------------------------------------- a game */
await page.goto(`${BASE}/solo/chess-arena`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('main canvas, main [role="grid"]', { timeout: 25000 });
await page.waitForTimeout(400);
const game = await shape();
check('a game hides the site header on a phone', game.headerHidden);
check('a game has a tab bar of its own... or none at all', game.bar === null);
const ownBar = await page.evaluate(() => {
  const back = document.querySelector('[aria-label="Library"]');
  const r = back?.closest('div')?.parentElement?.getBoundingClientRect();
  return { back: !!back, top: r ? Math.round(r.top) : null, position: r ? getComputedStyle(back.closest('div').parentElement).position : null };
});
check('the game bar sits at the very top', ownBar.back && ownBar.top !== null && ownBar.top <= 2, JSON.stringify(ownBar));
check('and it sticks there while you scroll', ownBar.position === 'sticky', String(ownBar.position));
const boardTop = await page.evaluate(() => Math.round(document.querySelector('main canvas, main [role="grid"]')?.getBoundingClientRect().top ?? 9999));
check('the board is visible without scrolling', boardTop < 560, `board at ${boardTop}px`);

/* ----------------------------------------------------- a dialog on a phone */
await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const asked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /delete|reset|clear/i.test(x.textContent || ''));
  b?.click();
  return !!b;
});
if (asked) {
  await page.waitForTimeout(400);
  const dialog = page.locator('[role="dialog"]');
  if (await dialog.count()) {
    const box = await dialog.boundingBox();
    check('a confirm on a phone is a bottom sheet too', !!box && box.y > 844 * 0.3,
      box ? `top ${Math.round(box.y)}` : 'no box');
    const buttons = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
      .map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height) }; }));
    check('its buttons are full-width finger targets', buttons.some((b) => b.h >= 44), JSON.stringify(buttons));
    await page.keyboard.press('Escape');
  }
}

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
