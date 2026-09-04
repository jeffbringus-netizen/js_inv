const LOG_TIMEZONE = process.env.LOG_TIMEZONE || 'Europe/Sofia';

function timestamp() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: LOG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date()).replace(' ', 'T');
}

function write(level, message, meta = undefined) {
  const suffix = meta && Object.keys(meta).length > 0
    ? ` ${JSON.stringify(meta)}`
    : '';
  const line = `[${timestamp()}] [${level}] ${message}${suffix}`;

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARNING') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

const info = (message, meta) => write('INFO', message, meta);
const warning = (message, meta) => write('WARNING', message, meta);
const error = (message, meta) => write('ERROR', message, meta);

module.exports = { info, warning, error };
