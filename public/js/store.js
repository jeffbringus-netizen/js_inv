// Shared application state. Read via S.<name> from any module; this is the
// only module allowed to reassign these values.
const S = {
  allProducts: [],
  searchQuery: '',
  productPage: 1,
  productPageMeta: { total: 0, limit: 100 },
  filters: {},
  sortKey: 'location',
  sortDir: 1,
  editingId: null,
  showArchived: localStorage.getItem('showArchived') === '1',
  showMargin: localStorage.getItem('showMargin') !== '0'
};

const selectedProductIds = new Set();

export { S, selectedProductIds };
