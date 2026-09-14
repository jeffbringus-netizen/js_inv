const XLSX = require('xlsx');
const { buildDeviceIndex, matchDeviceSegments } = require('./devices');

const PRODUCT_TYPES = [
  ['tempered_glass', /\b(?:tempered|protective|screen)\s+glass\b|\bglass\b/i],
  ['lens_protector', /\blens\s+protector\b|\bcamera\s+protector\b/i],
  ['case', /\b(?:phone|mobile)\s+case\b|\bcase\b|\bcover\b/i],
  ['cable', /\bcable\b|\bcharger\s+cable\b/i],
  ['charger', /\bcharger\b|\bpower\s+adapter\b/i],
  ['holder', /\bholder\b|\bstand\b|\bmount\b/i],
  ['power_bank', /\bpower\s*bank\b|\bpowerbank\b/i],
  ['headphones', /\bheadphones?\b|\bearbuds?\b|\bearphones?\b/i],
  ['card_reader', /\bcard\s+reader\b/i],
  ['smart_ring', /\bsmart\s+ring\b/i],
  ['light_bulb', /\bled\s+bulb\b|\blight\s+bulb\b/i],
  ['adapter', /\badapter\b|\bconverter\b/i]
];

const COLORS = [
  ['light blue', /\blight\s+blue\b/i], ['dark blue', /\bdark\s+blue\b/i],
  ['light green', /\blight\s+green\b/i], ['dark green', /\bdark\s+green\b/i],
  ['light purple', /\blight\s+purple\b/i], ['dark purple', /\bdark\s+purple\b/i],
  ['forest green', /\bforest\s+green\b/i], ['navy blue', /\bnavy\s+blue\b/i],
  ['rose gold', /\b(?:rose\s+gold|rosegold)\b/i],
  ['black', /\bblack\b/i], ['white', /\bwhite\b/i], ['red', /\bred\b/i],
  ['blue', /\bblue\b/i], ['green', /\bgreen\b/i], ['purple', /\bpurple\b/i],
  ['pink', /\bpink\b/i], ['yellow', /\byellow\b/i], ['orange', /\borange\b/i],
  ['brown', /\bbrown\b/i], ['gray', /\b(?:gray|grey)\b/i],
  ['transparent', /\b(?:transparent|clear)\b/i], ['silver', /\bsilver\b/i],
  ['mint', /\bmint\b/i],
  ['gold', /\bgold\b/i], ['beige', /\bbeige\b/i]
];

const VARIANTS = [
  'softflex', 'shockproof', 'antishock', 'slim', 'silicone', 'carbon',
  'magsafe', 'magnetic', 'privacy', 'premium', 'matte', 'clear', 'book',
  'wallet', 'hybrid', 'rugged', 'ultra', 'fast charging'
];

function text(value) {
  return typeof value === 'number' ? String(value) : String(value ?? '').trim();
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBrand(value) {
  return value.replace(/(\d+(?:\.\d+)?)\s+mm\b/gi, '$1mm').replace(/\s+/g, ' ').trim();
}

function cleanDeviceText(value, color) {
  let result = value
    .replace(/\b10\s*in\s*1(?:\s+G\d+)?\b/gi, '')
    .replace(/\bkompatybilne\s+z\s+fingerprint\b/gi, '')
    .replace(/\bfingerprint[- ]compatible\b/gi, '')
    .replace(/\bblack\s+frame\b/gi, '')
    .replace(/\bcamera\s+protection\b/gi, '')
    .replace(/\bbig\s+hole(?:\s*\+\s*button)?\b/gi, '')
    .replace(/\bopen\s+ring\b/gi, '')
    .replace(/\s+/g, ' ').trim();
  if (color) {
    const colorNames = [color.replace('_', ' ')];
    if (color === 'gray') colorNames.push('grey');
    result = result.replace(new RegExp(`\\s+(?:${colorNames.map(escapeRegExp).join('|')})\\s*$`, 'i'), '').trim();
  }
  return result;
}

function cleanSupplierName(value) {
  return text(value).replace(/"/g, '').trim();
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseName(originalName, db) {
  const source = cleanSupplierName(originalName);
  const lower = normalize(source);
  const parsed = {
    brand: null, product_type: null, product_variant: null,
    device_brand: null, device_model: null, device_variant: null,
    color: null, design: null, attributes: [], compatible_devices: [],
    original_name: source, name: source, category: null, devices: [], brand_price: null
  };
  if (!source) return parsed;

  const forMatch = source.match(/\s+for\s+(.+)$/i);
  const beforeFor = forMatch ? source.slice(0, forMatch.index).trim() : source;
  const temperedGlassIndex = normalize(beforeFor).indexOf('tempered glass');
  let hasSpecialBrand = false;
  if (temperedGlassIndex !== -1) {
    hasSpecialBrand = true;
    parsed.category = 'protector';
    parsed.brand = normalizeBrand(beforeFor.replace(/tempered\s+glass/i, ''));
    parsed.name = parsed.brand;
  } else if (/\bcase\b/i.test(beforeFor)) {
    hasSpecialBrand = true;
    parsed.category = 'case';
    parsed.brand = beforeFor.replace(/\s+case\s*$/i, '').trim();
    if (/^matt\s+tpu\s+case$/i.test(beforeFor)) parsed.brand = 'Matt TPU';
    parsed.name = parsed.brand;
  }

  const brands = db.prepare('SELECT name, price FROM brands').all();
  const knownBrand = brands
    .map(brand => ({ ...brand, key: normalize(brand.name) }))
    .filter(brand => lower.startsWith(brand.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (knownBrand && !hasSpecialBrand) {
    parsed.brand = knownBrand.name;
    parsed.brand_price = knownBrand.price == null ? null : knownBrand.price;
  } else if (!hasSpecialBrand) {
    const baseBrands = [...new Set(brands.map(brand => brand.name.split(' - ')[0]))]
      .map(name => ({ name, key: normalize(name) }))
      .filter(brand => lower.startsWith(brand.key + ' '))
      .sort((a, b) => b.key.length - a.key.length);
    if (baseBrands.length) parsed.brand = baseBrands[0].name;
  }

  // bulk packaging (10in1) gets its own brand entry so single-package and
  // bulk prices stay separate: "OG Premium" vs "OG Premium (bulk)"
  if (parsed.brand && /\b10\s*in\s*1\b/i.test(source) && !/\(bulk\)$/.test(parsed.brand)) {
    parsed.brand = `${parsed.brand} (bulk)`;
  }

  for (const [type, pattern] of PRODUCT_TYPES) {
    if (pattern.test(source)) {
      parsed.product_type = type;
      break;
    }
  }
  if (!parsed.category && parsed.product_type === 'tempered_glass') parsed.category = 'protector';
  if (!parsed.category && parsed.product_type === 'case') parsed.category = 'case';
  if (/\bcar\s+holder\b/i.test(source)) parsed.category = 'car holder';
  if (/\bcar\s+charger\b/i.test(source)) parsed.category = 'car charger';
  if (/\bwall\s+charger\b/i.test(source)) parsed.category = 'wall charger';
  if (/\b(?:tempered\s+)?glass\b.*\bfor\s+camera\b/i.test(source) ||
      /\bcamera\s+(?:glass|protector)\b/i.test(source) ||
      /\blens\s+glasses\b/i.test(source)) parsed.category = 'camera';
  if (/\b(?:bluetooth|bt)\s+earphones?\b/i.test(source)) parsed.category = 'bluetooth earphones';
  let compatibilityText = forMatch ? forMatch[1].trim() : '';
  if (/\bfor\s+camera\s+for\s+/i.test(source)) {
    compatibilityText = source.split(/\bfor\s+camera\s+for\s+/i)[1].trim();
  }
  const beforeCompatibility = forMatch ? source.slice(0, forMatch.index).trim() : source;
  if (parsed.brand && compatibilityText) parsed.name = `${parsed.brand} for ${normalizeBrand(compatibilityText)}`;

  for (const [color, pattern] of COLORS) {
    if ((compatibilityText && pattern.test(compatibilityText)) ||
        (!compatibilityText && pattern.test(beforeCompatibility))) {
      parsed.color = color;
      break;
    }
  }
  if (parsed.category === 'protector') {
    if (/\bblack\s+frame\b/i.test(source)) parsed.color = 'black frame';
    else if (/\b2,5d\b/i.test(source)) parsed.color = 'no frame';
    else if (/\b(?:og\s+premium(?:\s+privacy)?|ultra\s+strong|privacy|6d)\b/i.test(beforeCompatibility)) {
      parsed.color = 'black frame';
    }
  }

  let devices = compatibilityText
    ? compatibilityText.split('/').map(item => item.trim()).filter(Boolean)
    : [];
  devices = devices.map(device => cleanDeviceText(device, parsed.color)).filter(Boolean);
  const colorRecord = parsed.color
    ? db.prepare('SELECT id, tag_color, tag_text, tag_border FROM colors WHERE name = ?').get(parsed.color)
    : null;
  if (colorRecord) Object.assign(parsed, {
    color_id: colorRecord.id,
    tag_color: colorRecord.tag_color,
    tag_text: colorRecord.tag_text,
    tag_border: colorRecord.tag_border
  });
  // device matching is shared with the koff parser: full name, then
  // brand-scoped short names, then globally-unique shorts
  const deviceIndex = buildDeviceIndex(db, normalize);
  const deviceSegments = devices.map((device, index) => {
    if (!/^\dG$/i.test(device) || index === 0) return device;
    const previousDevice = deviceIndex.byName.get(normalize(devices[index - 1]));
    if (!previousDevice) return device;
    const variantDeviceName = previousDevice.full_name.replace(/\b\dG\b/i, device);
    return deviceIndex.byName.has(normalize(variantDeviceName)) ? variantDeviceName : device;
  });
  const matchedDevices = matchDeviceSegments(deviceIndex, deviceSegments, normalize);
  parsed.devices.push(...matchedDevices.devices);
  for (const deviceText of deviceSegments) {
    if (!matchedDevices.matchedKeys.has(normalize(deviceText))) {
      parsed.compatible_devices.push(deviceText);
    }
  }
  if (devices.length) {
    const firstDevice = devices[0].replace(/\b(?:4G|5G|global|eu|us)\b/gi, '').trim();
    const deviceParts = firstDevice.split(/\s+/).filter(Boolean);
    parsed.device_brand = deviceParts[0] || null;
    parsed.device_model = deviceParts.slice(1).join(' ') || null;
    const variantMatch = devices[0].match(/\b(4G|5G|Global|EU|US)\b/i);
    parsed.device_variant = variantMatch ? variantMatch[1].toLowerCase() : null;
  }

  const variantMatches = VARIANTS.filter(variant => lower.includes(variant));
  parsed.product_variant = variantMatches.length ? [...new Set(variantMatches)].join(', ') : null;
  const descriptors = [];
  if (/\bblack\s+frame\b/i.test(source)) descriptors.push('black frame');
  if (/\bfingerprint[- ]compatible\b/i.test(source)) descriptors.push('fingerprint-compatible');
  if (/\bcamera\s+protection\b/i.test(source)) descriptors.push('camera protection');
  const dimensions = source.match(/\b\d+(?:\.\d+)?\s*mm\b/gi);
  if (dimensions) descriptors.push(...dimensions);
  if (/\bfloral\b/i.test(source)) parsed.design = 'floral';
  parsed.design = parsed.design || (descriptors.length ? descriptors.join(', ') : null);
  parsed.attributes = descriptors.filter(item => item !== parsed.design);
  if (!parsed.product_type && !parsed.product_variant) parsed.attributes.push(source);
  return parsed;
}

function parse(data, db) {
  let workbook;
  try {
    workbook = XLSX.read(Buffer.from(data, 'base64'), { type: 'buffer' });
  } catch (e) {
    throw new Error('Could not read xlsx file: ' + e.message);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('xlsx file has no sheets');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const productBySku = new Map(db.prepare('SELECT * FROM products').all()
    .map(product => [String(product.sku).toLowerCase(), product]));
  const parsed = [];
  let shipping = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const entryNumber = parseInt(row[0], 10);
    const originalName = cleanSupplierName(row[1]);
    const sku = text(row[2]);
    const ean = text(row[3]);
    const quantity = parseInt(row[6], 10) || 0;
    const totalCost = parseFloat(text(row[7]).replace(',', '.')) || 0;
    if (!originalName && !sku && !ean && !quantity) continue;
    if (normalize(originalName) === 'shipping') {
      shipping = totalCost;
      continue;
    }
    const packageMultiplier = /\b10\s*in\s*1\b/i.test(originalName) ? 10 : 1;
    const receivedQuantity = quantity * packageMultiplier;
    const cost = receivedQuantity > 0 ? roundMoney(totalCost / receivedQuantity) : 0;
    const parsedName = parseName(originalName, db);
    const existing = sku ? productBySku.get(sku.toLowerCase()) || null : null;
    parsed.push({
      entry_number: Number.isNaN(entryNumber) ? null : entryNumber,
      supplier_name: originalName, original_name: originalName,
      sku, ean, quantity: receivedQuantity, cost,
      parsed: parsedName,
      existing: existing ? {
        id: existing.id, name: existing.name, sku: existing.sku, ean: existing.ean,
        quantity: existing.quantity, cost: existing.cost, supplier_name: existing.supplier_name
      } : null
    });
  }
  return {
    rows: parsed.sort((a, b) => (a.entry_number ?? Number.MAX_SAFE_INTEGER) - (b.entry_number ?? Number.MAX_SAFE_INTEGER)),
    shipping
  };
}

module.exports = { parse, parseName };