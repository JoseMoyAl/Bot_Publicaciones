const { DateTime } = require('luxon');
const { readJson, writeJson } = require('./storage');

const FILE = 'history.json';
const LIMIT = 1000;

function load() {
  const entries = readJson(FILE, []);
  return Array.isArray(entries) ? entries : [];
}

// Guarda cada intento de publicación (exitoso o con error).
// Solo se conservan los últimos 1000 para que el archivo no crezca sin límite.
function record(entry) {
  const entries = load();
  entries.push({ at: new Date().toISOString(), ...entry });
  writeJson(FILE, entries.slice(-LIMIT));
}

function isPublished(entry) {
  return entry.status === 'publicado';
}

function countRealToday(timezone) {
  const start = DateTime.now().setZone(timezone).startOf('day').toMillis();
  return load().filter((e) => isPublished(e) && !e.simulated && Date.parse(e.at) >= start).length;
}

function getStats(timezone) {
  const entries = load();
  const now = DateTime.now().setZone(timezone);

  const starts = {
    today: now.startOf('day'),
    week: now.startOf('week'),
    month: now.startOf('month'),
  };

  const periods = {};
  for (const [name, start] of Object.entries(starts)) {
    const inPeriod = entries.filter((e) => Date.parse(e.at) >= start.toMillis());
    periods[name] = {
      real: inPeriod.filter((e) => isPublished(e) && !e.simulated).length,
      simulated: inPeriod.filter((e) => isPublished(e) && e.simulated).length,
      errors: inPeriod.filter((e) => e.status === 'error').length,
    };
  }

  const bySource = { inmediata: 0, programada: 0, recurrente: 0 };
  entries
    .filter((e) => isPublished(e) && Date.parse(e.at) >= starts.month.toMillis())
    .forEach((e) => {
      bySource[e.source] = (bySource[e.source] || 0) + 1;
    });

  const realPosts = entries.filter((e) => isPublished(e) && !e.simulated);
  const errors = entries.filter((e) => e.status === 'error');

  return {
    periods,
    bySource,
    lastReal: realPosts[realPosts.length - 1] || null,
    recentErrors: errors.slice(-3).reverse(),
  };
}

module.exports = { record, countRealToday, getStats };