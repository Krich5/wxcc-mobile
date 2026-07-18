const STORAGE_KEY = 'wxcc-theme';

// Mirrors the inline boot script in index.html (which sets the initial attribute before
// first paint) -- this is only for reading the current value back into React state and
// for applying a change the user makes via the toggle.
export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing / storage disabled -- the toggle still works for this page load,
    // it just won't be remembered next time.
  }
}
