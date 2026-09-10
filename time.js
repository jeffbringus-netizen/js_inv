// Single place for timezone handling.
// Timestamps are stored in UTC (SQLite datetime('now')) and converted to the
// configured timezone only for display. APP_TIMEZONE is the primary setting;
// LOG_TIMEZONE is accepted for backwards compatibility.
const TZ = process.env.APP_TIMEZONE || process.env.LOG_TIMEZONE || 'Europe/Sofia';

const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

// 'YYYY-MM-DD HH:MM:SS' (UTC as stored by SQLite) -> same format in TZ
function toLocaltime(utcText) {
  if (!utcText) return utcText;
  const iso = utcText.includes('T') ? utcText : utcText.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return utcText;
  return formatter.format(date);
}

module.exports = { TZ, toLocaltime };
