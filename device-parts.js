// Device name decomposition shared by the stock import and the backfill tool.
// Splits a device full name into brand/series/model using conservative
// name-prefix rules; anything unmatched is left for manual decomposition.
const RULES = [
  ['Samsung', 'Galaxy', /^Samsung Galaxy\b/i],
  ['Google', 'Pixel', /^Google Pixel\b/i],
  ['Apple', 'iPhone', /^iPhone\b/i],
  ['Apple', 'iPad', /^iPad\b/i],
  ['Apple', 'Watch', /^Apple Watch\b/i],
  ['Apple', 'AirPods', /^AirPods\b/i],
  ['Sony', 'Xperia', /^Sony Xperia\b/i],
  ['Xiaomi', 'Redmi', /^Xiaomi Redmi\b/i],
  ['Xiaomi', 'Poco', /^Xiaomi Poco\b/i],
  ['Xiaomi', 'Mi', /^Xiaomi Mi\b/i],
  ['Xiaomi', null, /^Xiaomi\b/i],
  ['Huawei', 'P', /^Huawei P\d/i],
  ['Huawei', 'Pura', /^Huawei Pura\b/i],
  ['Huawei', 'Mate', /^Huawei Mate\b/i],
  ['Huawei', 'Nova', /^Huawei Nova\b/i],
  ['Huawei', 'Y', /^Huawei Y\d/i],
  ['Honor', null, /^Honor\b/i],
  ['OPPO', 'Reno', /^OPPO Reno\b/i],
  ['OPPO', 'Find', /^OPPO Find\b/i],
  ['OnePlus', null, /^OnePlus\b/i],
  ['Realme', null, /^Realme\b/i],
  ['Vivo', null, /^Vivo\b/i],
  ['Motorola', 'Edge', /^Motorola Edge\b/i],
  ['Motorola', 'Moto', /^Motorola Moto\b/i],
  ['Nokia', null, /^Nokia\b/i],
  ['TCL', null, /^TCL\b/i],
  [null, 'Redmi', /^Redmi\b/i], // stock names sometimes drop the Xiaomi prefix
  [null, 'Poco', /^Poco\b/i]
];

// 'Google Pixel 9 Pro' -> { brand: 'Google', series: 'Pixel', model: '9 Pro' }
// A brand that is not an actual prefix of the name is dropped (Apple on
// "iPhone XS"), keeping the decomposition consistent with the composed full
// name. Returns nulls for unknown patterns.
function decomposeDevice(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return { brand: null, series: null, model: null };
  const rule = RULES.find(([, , re]) => re.test(name));
  if (!rule) return { brand: null, series: null, model: null }; // unknown pattern: leave undecomposed
  let brand = rule ? rule[0] : null;
  let series = rule ? rule[1] : null;
  let rest = name;
  const stripPrefix = (text, prefix) => {
    if (!prefix) return text;
    // prefix must end at a token boundary; glued single-letter series like
    // Huawei "P30" cannot round-trip (composition would add a space), so they
    // deliberately stay undecomposed at the series level
    const re = new RegExp('^' + String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: |$)', 'i');
    return re.test(text) ? text.slice(prefix.length).trim() : null;
  };
  if (brand) {
    const stripped = stripPrefix(rest, brand);
    if (stripped === null) brand = null; // name does not contain the brand
    else rest = stripped;
  }
  if (series) {
    const stripped = stripPrefix(rest, series);
    if (stripped === null) series = null;
    else rest = stripped;
  }
  const composed = [brand, series, rest].filter(Boolean).join(' ');
  if (composed !== name) return { brand: null, series: null, model: null };
  return { brand, series, model: rest || null };
}

module.exports = { RULES, decomposeDevice };
