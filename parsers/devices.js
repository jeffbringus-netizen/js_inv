// Shared device matching for the purchase parsers.
//
// Supplier names mix full device names and bare models ("Google Pixel 9 /
// 9 Pro / 10 / 10 Pro"). Bare models are ambiguous across brands ("11 Pro"
// exists for iPhone and Pixel), so matching happens in tiers:
//   1. full device name ("Google Pixel 9")
//   2. bare model among devices of the SAME BRAND as the last full match,
//      preferring the same series ("9 Pro" -> Google Pixel 9 Pro)
//   3. bare model that is globally unique (only one device uses it)
// Anything else stays unmatched (tfo keeps it in compatible_devices).

function buildDeviceIndex(db, normalize) {
  const rows = db.prepare('SELECT id, full_name, model, brand, series FROM devices').all();
  const byName = new Map();   // normalize(full_name) -> device (first wins on collision)
  const byShort = new Map();  // normalize(model) -> device[]
  for (const d of rows) {
    const nameKey = normalize(d.full_name);
    if (!byName.has(nameKey)) byName.set(nameKey, d);
    if (d.model) {
      const shortKey = normalize(d.model);
      if (!byShort.has(shortKey)) byShort.set(shortKey, []);
      if (!byShort.get(shortKey).some(x => x.id === d.id)) byShort.get(shortKey).push(d);
    }
  }
  return { byName, byShort };
}

function matchDeviceSegments(index, segments, normalize) {
  const devices = [];
  const matchedKeys = new Set(); // normalized texts that resolved to a device
  const seenIds = new Set();
  let ctx = null; // { brand, series } carried from the last matched device

  for (const raw of segments) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const key = normalize(text);
    let device = index.byName.get(key) || null;

    if (!device && ctx && ctx.brand != null) {
      const sameBrand = (index.byShort.get(key) || [])
        .filter(d => d.brand != null && normalize(d.brand) === normalize(ctx.brand));
      const sameSeries = ctx.series != null
        ? sameBrand.filter(d => d.series != null && normalize(d.series) === normalize(ctx.series))
        : [];
      const pool = sameSeries.length ? sameSeries : sameBrand;
      if (pool.length === 1) device = pool[0];
    }

    if (!device) {
      const global = index.byShort.get(key) || [];
      if (global.length === 1) device = global[0]; // unambiguous across all brands
    }

    if (device) {
      matchedKeys.add(key);
      if (!seenIds.has(device.id)) { seenIds.add(device.id); devices.push(device); }
      ctx = { brand: device.brand, series: device.series };
    }
  }
  return { devices, matchedKeys };
}

module.exports = { buildDeviceIndex, matchDeviceSegments };
