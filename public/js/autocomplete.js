import { $, esc, eur } from './ui.js';

// ---------- autocomplete widget ----------
const AC_CONFIG = {
  categories: { label: 'Category', single: true },
  brands: { label: 'Brand', single: true, prefill: true },
  suppliers: { label: 'Manufacturer / Supplier', single: true, promptFullName: true },
  locations: { label: 'Location', single: true },
  colors: { label: 'Color', single: true, colorDefaults: true },
  devices: { label: 'Compatible devices', multi: true, promptYear: true },
  features: { label: 'Features', multi: true }
};

export function createAutocomplete(container, type, onChange) {
  const cfg = AC_CONFIG[type];
  container.classList.add('ac');
  const label = cfg.single ? `${cfg.label}` : `${cfg.label} <span class="text-muted small">(add multiple)</span>`;
  container.innerHTML = `
    <label class="form-label">${label}</label>
    <input type="text" class="form-control" autocomplete="off" placeholder="Type to search...">
    ${cfg.multi ? '<div class="selected-badges d-flex flex-wrap gap-1 mt-1"></div>' : ''}
    <input type="hidden" class="ac-value">`;

  const input = container.querySelector('input[type=text]');
  const listEl = document.createElement('div');
  listEl.className = 'ac-list d-none';
  container.appendChild(listEl);
  const floatList = !!container.closest('#productModal');

  function positionList() {
    if (!floatList) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < 120 && rect.top > 120;
    const available = showAbove ? rect.top - 8 : spaceBelow - 8;
    listEl.style.position = 'fixed';
    listEl.style.left = `${rect.left}px`;
    listEl.style.width = `${rect.width}px`;
    listEl.style.maxHeight = `${Math.min(220, Math.max(80, available))}px`;
    listEl.style.top = showAbove ? `${rect.top - Math.min(220, available)}px` : `${rect.bottom}px`;
  }

  const state = { selected: [] }; // [{id, name, ...}]
  const api = {
    get value() { return cfg.single ? (state.selected[0]?.id ?? null) : state.selected.map(s => s.id); },
    set(items) {
      state.selected = items ? [...items] : [];
      renderBadges();
    },
    getSelected() { return state.selected; }
  };

  function displayValue(rec) {
    if (type === 'brands' && rec?.price != null) return `${rec.name} (${eur(rec.price)})`;
    return rec?.name || '';
  }

  function renderBadges() {
    const badgeBox = container.querySelector('.selected-badges');
    if (!badgeBox) {
      input.value = displayValue(state.selected[0]);
      if (type === 'colors') {
        const color = state.selected[0];
        input.style.backgroundColor = color?.tag_color || '';
        input.style.color = color?.tag_text || '';
        input.style.borderColor = color?.tag_border || '';
      }
      return;
    }
    badgeBox.innerHTML = state.selected.map((s, i) =>
      `<span class="badge text-bg-primary">${esc(s.name)}<i class="bi bi-x-lg" data-i="${i}" style="cursor:pointer;margin-left:.3em"></i></span>`).join('');
  }

  badgeBoxClick(container, i => { state.selected.splice(i, 1); renderBadges(); if (onChange) onChange(); });

  async function search() {
    const q = input.value.trim();
    if (!q) { listEl.classList.add('d-none'); return; }
    const rows = await fetch(`/api/entities/${type}?q=` + encodeURIComponent(q)).then(r => r.json());
    const exact = rows.some(r => r.name.toLowerCase() === q.toLowerCase());
    let html = rows.map((r, i) => `<div class="ac-item" data-i="${i}">${type === 'colors' ? `<span class="badge" style="background:${esc(r.tag_color)};color:${esc(r.tag_text)};border:1px solid ${esc(r.tag_border)}">${esc(r.name)}</span>` : esc(r.name)}${r.year ? ` <span class="text-muted small">(${r.year})</span>` : ''}${type === 'brands' && r.price != null ? ` <span class="text-muted small">(${esc(eur(r.price))})</span>` : ''}</div>`).join('');
    if (!exact) html += `<div class="ac-hint">No match for "${esc(q)}" — press Enter to add</div>`;
    listEl.innerHTML = html;
    listEl.rows = rows;
    positionList();
    listEl.classList.remove('d-none');
  }

  let searchTimer;
  input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 200); });
  input.addEventListener('focus', search);
  if (floatList) {
    window.addEventListener('resize', positionList);
    window.addEventListener('scroll', positionList, true);
  }

  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const exact = (listEl.rows || []).find(r => r.name.toLowerCase() === q.toLowerCase());
    if (exact) return select(exact);
    // create new entity
    const body = { name: q };
    if (cfg.colorDefaults) {
      body.tag_color = '#6c757d';
      body.tag_text = '#ffffff';
      body.tag_border = '#6c757d';
    }
    if (cfg.promptYear) {
      const y = prompt(`Year for new device "${q}":`, new Date().getFullYear());
      if (y === null) return;
      body.year = parseInt(y, 10) || new Date().getFullYear();
    }
    if (cfg.promptFullName) {
      const fn = prompt(`Full name for new supplier "${q}":`, q);
      if (fn === null) return;
      body.full_name = fn || q;
    }
    const created = await fetch(`/api/entities/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    select(created);
  });

  listEl.addEventListener('mousedown', e => {
    const item = e.target.closest('.ac-item');
    if (!item) return;
    e.preventDefault();
    select(listEl.rows[Number(item.dataset.i)]);
  });

  input.addEventListener('blur', () => setTimeout(() => listEl.classList.add('d-none'), 150));

  function select(rec) {
    if (!rec) return;
    if (cfg.single) {
      state.selected = [rec];
      input.value = displayValue(rec);
      if (cfg.prefill && rec.price != null && container.closest('#productForm')) {
        const form = $('#productForm');
        if (!form.price.dataset.touched) form.price.value = rec.price;
        if (!form.cost.dataset.touched) form.cost.value = rec.cost ?? '';
      }
    } else {
      if (!state.selected.some(s => s.id === rec.id)) state.selected.push(rec);
      input.value = '';
    }
    renderBadges();
    listEl.classList.add('d-none');
    if (onChange) onChange();
  }

  return api;
}

function badgeBoxClick(container, onRemove) {
  const box = container.querySelector('.selected-badges');
  if (!box) return;
  box.addEventListener('click', e => {
    if (e.target.dataset.i !== undefined) onRemove(Number(e.target.dataset.i));
  });
}

export const acWidgets = {};
document.querySelectorAll('[data-ac]').forEach(el => {
  acWidgets[el.dataset.ac] = createAutocomplete(el, el.dataset.ac);
});