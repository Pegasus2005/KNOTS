for (const control of document.querySelectorAll('[data-theme-toggle]')) {
  const footer = control.parentElement.querySelector('.sidebar-foot');
  if (footer) control.parentElement.insertBefore(control, footer);
}
const key = 'knots-theme';
const preference = matchMedia('(prefers-color-scheme: dark)');
function apply(value) {
  document.documentElement.dataset.theme = value === 'dark' ? 'dark' : 'light';
  for (const control of document.querySelectorAll('[data-theme-toggle]')) {
    control.textContent = value === 'dark' ? '☀ Light mode' : '☾ Dark mode';
    control.setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} mode`);
  }
}
const saved = () => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
apply(saved() || (preference.matches ? 'dark' : 'light'));
for (const control of document.querySelectorAll('[data-theme-toggle]'))
  control.addEventListener('click', () => {
    const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Session-only if storage is unavailable. */
    }
    apply(value);
  });
addEventListener('storage', (event) => {
  if (event.key === key) apply(saved() || (preference.matches ? 'dark' : 'light'));
});
preference.addEventListener('change', () => {
  if (!saved()) apply(preference.matches ? 'dark' : 'light');
});
