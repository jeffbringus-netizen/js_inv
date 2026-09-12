// Application entry point. All behavior lives in the feature modules;
// this file only wires initial state and renders the first view.
import { $ } from './ui.js';
import { S } from './store.js';
import { loadProducts } from './products.js';
import { selectView } from './router.js';
// side-effect modules: pages that wire themselves up and export nothing —
// importing them is what attaches their event handlers
import './webstock.js';
import './labels.js';

$('#showArchived').checked = S.showArchived;
$('#showMargin').checked = S.showMargin;
loadProducts();
selectView(window.location.pathname.slice(1) || window.location.hash.slice(1) || 'products', false);
