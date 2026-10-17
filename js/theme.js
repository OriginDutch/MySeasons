// Thema: light (standaard), dim, dark of system.
// De voorkeur is een gemak per apparaat en staat daarom in localStorage.

const KEY = 'ms-theme';
const VALID = ['light', 'dim', 'dark', 'system'];
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v) ? v : 'light';
  } catch {
    return 'light';
  }
}

function resolve(pref) {
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

// Clubkleuren: standaard aan, per apparaat uit te zetten.
const CLUB_KEY = 'ms-club';

export function getClubColors() {
  try { return localStorage.getItem(CLUB_KEY) !== 'off'; } catch { return true; }
}

export function setClubColors(on) {
  try { localStorage.setItem(CLUB_KEY, on ? 'on' : 'off'); } catch { /* alleen deze sessie */ }
  applyTheme();
}

export function applyTheme(pref = getThemePref()) {
  const resolved = resolve(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-club', getClubColors() ? 'on' : 'off');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute('content', bg);
}

export function setThemePref(pref) {
  if (!VALID.includes(pref)) return;
  try { localStorage.setItem(KEY, pref); } catch { /* opslag geblokkeerd: thema geldt alleen deze sessie */ }
  applyTheme(pref);
}

export function initTheme() {
  applyTheme();
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
