// Application UI configuration.
// Change APP_VERSION when preparing the next application version/release.
window.APP_CONFIG = {
  APP_VERSION: 'v1.0.1'
};

// Render the application version without putting the value in HTML.
document.addEventListener('DOMContentLoaded', () => {
  const sideMenu = document.getElementById('sideMenu');
  if (!sideMenu) return;

  sideMenu.style.display = 'flex';
  sideMenu.style.flexDirection = 'column';

  const version = document.createElement('div');
  version.className = 'sidebar-version';
  version.setAttribute('aria-label', 'Application version');
  version.textContent = window.APP_CONFIG.APP_VERSION;
  version.style.marginTop = 'auto';
  version.style.padding = '.75rem .5rem .25rem';
  version.style.color = '#6c757d';
  version.style.fontSize = '.8rem';
  version.style.textAlign = 'center';
  version.style.borderTop = '1px solid rgba(255,255,255,.08)';
  sideMenu.appendChild(version);
});
