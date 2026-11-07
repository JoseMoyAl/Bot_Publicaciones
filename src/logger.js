const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

function getTodayLogName() {
  return `bot-${DateTime.now().toFormat('yyyy-MM-dd')}.log`;
}

// Cada línea queda así:
// [2026-10-23 14:30:05] [OK] Publicación inmediata en Bluesky | {"url":"https://..."}
function write(level, message, details) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    const timestamp = DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss');
    let extra = '';
    if (details !== undefined) {
      extra = ` | ${typeof details === 'string' ? details : JSON.stringify(details)}`;
    }

    const line = `[${timestamp}] [${level}] ${message}${extra}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, getTodayLogName()), line, 'utf8');
  } catch {
    // Si el log falla (disco lleno, permisos), el bot sigue funcionando
  }
}

module.exports = {
  getTodayLogName,
  info: (message, details) => write('INFO', message, details),
  success: (message, details) => write('OK', message, details),
  warning: (message, details) => write('AVISO', message, details),
  error: (message, details) => write('ERROR', message, details),
};