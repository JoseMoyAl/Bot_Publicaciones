const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { readJson, writeJson, DATA_DIR } = require('./storage');
const { publishPost } = require('./publish-service');

const FILE = 'recurring.json';
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const CHECK_INTERVAL_MS = 30 * 1000;
const MAX_DELAY_MINUTES = 15;
const SEARCH_LIMIT_DAYS = 400;

const WEEKDAY_LETTERS = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 7 };
const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

let timer = null;
let checking = false;
let notify = () => {};

// ─── Reglas de repetición ───────────────────────────────────────

// "L, X, V" → [1, 3, 5]  (1 = lunes ... 7 = domingo). Devuelve null si algo no es válido.
function parseWeekdays(input) {
  const parts = input.toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;

  const days = [];
  for (const part of parts) {
    const day = WEEKDAY_LETTERS[part];
    if (!day) return null;
    if (!days.includes(day)) days.push(day);
  }
  return days.sort((a, b) => a - b);
}

// "1, 15" → [1, 15]. Devuelve null si algún número no está entre 1 y 31.
function parseMonthDays(input) {
  const parts = input.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;

  const days = [];
  for (const part of parts) {
    const day = Number(part);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    if (!days.includes(day)) days.push(day);
  }
  return days.sort((a, b) => a - b);
}

function joinList(items) {
  if (items.length === 1) return String(items[0]);
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function formatTime(time) {
  return DateTime.fromFormat(time, 'HH:mm').setLocale('es').toFormat('h:mm a');
}

// Texto legible de la regla: "Cada lunes y viernes a las 9:00 a. m."
function describeRule(rule) {
  const time = formatTime(rule.time);

  if (rule.frequency === 'diaria') {
    return `Todos los días a las ${time}`;
  }

  if (rule.frequency === 'semanal') {
    const names = rule.days.map((day) => WEEKDAY_NAMES[day - 1]);
    return `Cada ${joinList(names)} a las ${time}`;
  }

  const days = rule.days.length === 1
    ? `El día ${rule.days[0]}`
    : `Los días ${joinList(rule.days)}`;
  const note = rule.days.some((day) => day > 28) ? ' (o el último día, si el mes es más corto)' : '';
  return `${days} de cada mes a las ${time}${note}`;
}

// ¿Esta fecha cumple la regla?
function matchesDay(rule, day) {
  if (rule.frequency === 'diaria') return true;
  if (rule.frequency === 'semanal') return rule.days.includes(day.weekday);

  // Mensual: si eligieron el 31 y el mes tiene 30 días, se usa el último día del mes
  if (rule.days.includes(day.day)) return true;
  const isLastDay = day.day === day.daysInMonth;
  return isLastDay && rule.days.some((d) => d > day.daysInMonth);
}

// Revisa día por día desde "afterIso" hasta encontrar el primero que cumpla la regla.
// Devuelve el momento exacto en UTC.
function computeNextRun(rule, afterIso) {
  const after = Date.parse(afterIso);
  const [hour, minute] = rule.time.split(':').map(Number);
  let day = DateTime.fromMillis(after).setZone(rule.timezone).startOf('day');

  for (let i = 0; i < SEARCH_LIMIT_DAYS; i++) {
    const candidate = day.set({ hour, minute });
    if (candidate.toMillis() > after && matchesDay(rule, day)) {
      return candidate.toUTC().toISO();
    }
    day = day.plus({ days: 1 });
  }

  return null;
}

// ─── Lectura y escritura ────────────────────────────────────────

function load() {
  return readJson(FILE, { nextId: 1, items: [] });
}

function save(data) {
  writeJson(FILE, data);
}

function updateItem(id, changes) {
  const data = load();
  const item = data.items.find((i) => i.id === id);
  if (item) {
    Object.assign(item, changes);
    save(data);
  }
  return item;
}

function nowIso() {
  return new Date().toISOString();
}

// ─── Funciones que usa el menú ──────────────────────────────────

function createRecurring({ postData, image, platform, rule }) {
  const nextRunAt = computeNextRun(rule, nowIso());
  if (!nextRunAt) {
    throw new Error('Esa regla no produce ninguna fecha futura');
  }

  const data = load();
  const id = `REC-${data.nextId}`;
  data.nextId += 1;

  // La imagen se guarda una vez y se reutiliza en cada repetición
  let imageFile = null;
  if (image) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    imageFile = `${id}.jpg`;
    fs.writeFileSync(path.join(IMAGES_DIR, imageFile), image.data);
  }

  const item = {
    id,
    platform,
    status: 'activa',
    rule,
    postData: {
      text: postData.text,
      hashtags: postData.hashtags || '',
      mentions: postData.mentions || '',
      imageAlt: postData.imageAlt || '',
    },
    imageFile,
    nextRunAt,
    lastRunAt: null,
    lastResult: null,
    runCount: 0,
    createdAt: nowIso(),
  };

  data.items.push(item);
  save(data);
  return item;
}

// Primero las activas (ordenadas por próxima ejecución), después las pausadas
function getAll() {
  return load().items.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'activa' ? -1 : 1;
    return Date.parse(a.nextRunAt || a.createdAt) - Date.parse(b.nextRunAt || b.createdAt);
  });
}

function getActive() {
  return getAll().filter((item) => item.status === 'activa');
}

function toggleRecurring(id) {
  const item = load().items.find((i) => i.id === id);
  if (!item) return { success: false, error: 'No existe esa recurrencia' };

  if (item.status === 'activa') {
    updateItem(id, { status: 'pausada', nextRunAt: null });
    return { success: true, status: 'pausada' };
  }

  // Al reactivar se calcula desde ahora, para no publicar lo que se saltó mientras estaba pausada
  const nextRunAt = computeNextRun(item.rule, nowIso());
  updateItem(id, { status: 'activa', nextRunAt });
  return { success: true, status: 'activa', nextRunAt };
}

function deleteRecurring(id) {
  const data = load();
  const item = data.items.find((i) => i.id === id);
  if (!item) return { success: false, error: 'No existe esa recurrencia' };

  data.items = data.items.filter((i) => i.id !== id);
  save(data);

  if (item.imageFile) {
    fs.rmSync(path.join(IMAGES_DIR, item.imageFile), { force: true });
  }
  return { success: true };
}

// ─── Ejecución automática ───────────────────────────────────────

async function runOccurrence(item) {
  const delayMinutes = (Date.now() - Date.parse(item.nextRunAt)) / 60000;
  const nextRunAt = computeNextRun(item.rule, nowIso());

  if (delayMinutes > MAX_DELAY_MINUTES) {
    updateItem(item.id, {
      nextRunAt,
      lastResult: { status: 'omitida', at: nowIso(), error: 'El bot estaba cerrado a la hora programada' },
    });
    notify({
      type: 'warning',
      message: `${item.id}: se omitió una repetición`,
      detail: 'El bot estaba cerrado a la hora programada',
    });
    return;
  }

  // Se avanza a la siguiente fecha ANTES de publicar: si algo falla o el bot
  // se cierra a la mitad, esta repetición no se vuelve a intentar (sin duplicados)
  updateItem(item.id, { nextRunAt });

  try {
    const result = await publishPost({
      platformId: item.platform,
      postData: {
        ...item.postData,
        imageSource: item.imageFile ? path.join(IMAGES_DIR, item.imageFile) : null,
      },
      source: 'recurrente',
      sourceId: item.id,
    });

    updateItem(item.id, {
      lastRunAt: nowIso(),
      runCount: item.runCount + 1,
      lastResult: { status: 'publicado', at: nowIso(), url: result.url, simulated: result.simulated },
    });
    notify({
      type: 'success',
      message: `${item.id} publicado${result.simulated ? ' (simulación)' : ''}`,
      detail: result.url || result.id,
    });
  } catch (error) {
    updateItem(item.id, {
      lastRunAt: nowIso(),
      lastResult: { status: 'error', at: nowIso(), error: error.message },
    });
    notify({
      type: 'error',
      message: `${item.id} no se pudo publicar`,
      detail: error.message,
    });
  }
}

async function checkDueRecurring() {
  // Si la revisión anterior sigue publicando, esta no arranca
  if (checking) return;
  checking = true;

  try {
    const due = getActive().filter((item) => Date.parse(item.nextRunAt) <= Date.now());

    for (const item of due) {
      // Se vuelve a leer por si la pausaron o eliminaron mientras se publicaba otra
      const current = load().items.find((i) => i.id === item.id);
      if (current?.status === 'activa' && Date.parse(current.nextRunAt) <= Date.now()) {
        await runOccurrence(current);
      }
    }
  } catch (error) {
    notify({
      type: 'error',
      message: 'Error al revisar publicaciones recurrentes',
      detail: error.message,
    });
  } finally {
    checking = false;
  }
}

function startRecurring(onEvent) {
  notify = onEvent;
  checkDueRecurring();
  timer = setInterval(checkDueRecurring, CHECK_INTERVAL_MS);
}

function stopRecurring() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  parseWeekdays,
  parseMonthDays,
  describeRule,
  computeNextRun,
  createRecurring,
  getAll,
  getActive,
  toggleRecurring,
  deleteRecurring,
  startRecurring,
  stopRecurring,
};