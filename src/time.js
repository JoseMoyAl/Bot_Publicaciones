const { DateTime, IANAZone } = require('luxon');

const LOCALE = 'es';

function isValidZone(zone) {
  return Boolean(zone) && IANAZone.isValidZone(zone);
}

// Acepta "hoy", "mañana", "25/10/2026" o "2026-10-25". Devuelve "2026-10-25" o null.
function parseDateInput(input, zone) {
  const value = input.trim().toLowerCase();
  const today = DateTime.now().setZone(zone);

  if (value === 'hoy') return today.toISODate();
  if (value === 'mañana' || value === 'manana') return today.plus({ days: 1 }).toISODate();

  for (const format of ['d/M/yyyy', 'yyyy-M-d']) {
    const date = DateTime.fromFormat(value, format, { zone });
    if (date.isValid) return date.toISODate();
  }

  return null;
}

// Acepta "2:30 PM", "2:30pm", "2:30 p.m." o "14:30". Devuelve "14:30" o null.
function parseTimeInput(input) {
  const value = input
    .trim()
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s*([AP])\s*M$/, ' $1M');

  for (const format of ['h:mm a', 'H:mm']) {
    const time = DateTime.fromFormat(value, format, { locale: 'en-US' });
    if (time.isValid) return time.toFormat('HH:mm');
  }

  return null;
}

// Fecha + hora "de reloj" en una zona horaria → momento exacto en UTC
function toInstant(date, time, zone) {
  const dateTime = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', { zone });
  return dateTime.isValid ? dateTime.toUTC().toISO() : null;
}

// "domingo 25 de octubre, 2:30 p. m."
function formatDateTime(iso, zone) {
  return DateTime.fromISO(iso)
    .setZone(zone)
    .setLocale(LOCALE)
    .toFormat("cccc d 'de' LLLL, h:mm a");
}

// "en 2 horas", "hace 5 minutos"
function relativeTime(iso) {
  return DateTime.fromISO(iso).setLocale(LOCALE).toRelative();
}

// Hora actual: "2:30 p. m."
function formatClock(zone) {
  return DateTime.now().setZone(zone).setLocale(LOCALE).toFormat('h:mm a');
}

module.exports = {
  isValidZone,
  parseDateInput,
  parseTimeInput,
  toInstant,
  formatDateTime,
  relativeTime,
  formatClock,
};