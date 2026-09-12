// View routing: sidebar/menu tabs, hash-based navigation and per-view loading.
import { $ } from './ui.js';
import { loadOrders } from './sales.js';
import { loadPurchases } from './purchases.js';
import { loadHistory } from './history.js';
import { loadBackups } from './backups.js';
import { openEntityTab, ENTITY_DEFS } from './entities.js';

const menuToggle = $('#menuToggle');
menuToggle.setAttribute('aria-expanded', 'false');
menuToggle.addEventListener('click', () => {
  const visible = document.body.classList.toggle('sidebar-visible');
  menuToggle.setAttribute('aria-expanded', String(visible));
});

const VIEW_IDS = {
  products: '#productsView',
  sales: '#ordersView',
  purchases: '#purchasesView',
  locations: '#entitiesView',
  devices: '#entitiesView',
  categories: '#entitiesView',
  brands: '#entitiesView',
  suppliers: '#entitiesView',
  features: '#entitiesView',
  colors: '#entitiesView',
  history: '#historyView',
  backups: '#backupsView',
  webstock: '#webstockView',
  labels: '#labelsView'
};

function selectView(view, updateUrl = true) {
  if (!VIEW_IDS[view]) view = 'products';

  document.querySelectorAll('#mainTabs .nav-link').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  const targetSel = VIEW_IDS[view];
  for (const sel of new Set(Object.values(VIEW_IDS))) {
    $(sel).classList.toggle('d-none', sel !== targetSel);
  }
  if (view === 'sales') loadOrders();
  else if (view === 'purchases') loadPurchases();
  else if (view === 'history') loadHistory();
  else if (view === 'backups') loadBackups();
  else if (ENTITY_DEFS[view]) openEntityTab(view);
  if (updateUrl && window.location.pathname !== `/${view}`) {
    window.history.pushState(null, '', `/${view}`);
  }
  if (window.innerWidth <= 767) {
    document.body.classList.remove('sidebar-visible');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
}

document.querySelectorAll('#mainTabs .nav-link').forEach(button => {
  button.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectView(button.dataset.view);
  });
});

window.addEventListener('hashchange', () => {
  selectView(window.location.hash.slice(1), false);
});

window.addEventListener('popstate', () => {
  selectView(window.location.pathname.slice(1) || 'products', false);
});

export { selectView };
