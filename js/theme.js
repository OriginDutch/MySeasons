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

export function applyTheme(pref = getThemePref()) {
  const resolved = resolve(pref);
  document.documentElement.setAttribute('data-theme', resolved);
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
