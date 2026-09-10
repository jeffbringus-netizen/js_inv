// Application entry point. All behavior lives in the feature modules;
// this file only wires initial state and renders the first view.
import { $ } from './ui.mjs';
import { S } from './store.mjs';
import { loadProducts } from './products.mjs';
import { selectView } from './router.mjs';
// side-effect modules: pages that wire themselves up and export nothing —
// importing them is what attaches their event handlers
import './webstock.mjs';
import './labels.mjs';

$('#showArchived').checked = S.showArchived;
$('#showMargin').checked = S.showMargin;
loadProducts();
selectView(window.location.hash.slice(1) || 'products', false);
