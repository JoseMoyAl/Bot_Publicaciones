const readline = require('readline/promises');
const { loadSettings, saveSettings } = require('./settings');
const { getPublisher, listPublishers } = require('./publishers');
const { publishPrepared } = require('./publish-service');
const scheduler = require('./scheduler');
const recurring = require('./recurring');
const history = require('./history');
const logger = require('./logger');
const {
  isValidZone,
  parseDateInput,
  parseTimeInput,
  toInstant,
  formatDateTime,
  relativeTime,
  formatClock,
} = require('./time');

const COMMON_TIMEZONES = [
  'America/Guatemala',
  'America/Mexico_City',
  'America/El_Salvador',
  'America/Tegucigalpa',
  'America/Costa_Rica',
  'America/Bogota',
  'America/Lima',
  'America/New_York',
  'Europe/Madrid',
];

const STATUS_LABELS = {
  publicado: '✅ Publicado',
  error: '❌ Error',
  vencido: '⚠️  Vencido',
  cancelado: '🚫 Cancelado',
};

const RESULT_LABELS = {
  publicado: '✅ Publicada',
  error: '❌ Falló',
  omitida: '⚠️  Omitida',
};

let rl = null;
const notifications = [];

// ─── Utilidades ─────────────────────────────────────────────────

async function ask(question) {
  return (await rl.question(question)).trim();
}

async function askYesNo(question) {
  return (await ask(`${question} (si/no): `)).toLowerCase() === 'si';
}

async function pause() {
  await rl.question('\nPresiona ENTER para continuar...');
}

function showHeader(title) {
  console.clear();
  console.log('═'.repeat(50));
  console.log(title);
  console.log('═'.repeat(50) + '\n');
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function getCurrentPublisher() {
  const settings = loadSettings();
  return getPublisher(settings.platform) || getPublisher('simulacion');
}

function platformName(id) {
  return getPublisher(id)?.name || id;
}

// ─── Avisos de tareas en segundo plano ──────────────────────────

// Se muestra al instante y además se guarda para verlo en el menú principal,
// porque al limpiar la pantalla el aviso desaparecería
function handleBackgroundEvent(event) {
  const icons = { success: '✅', error: '❌', warning: '⚠️' };
  const { timezone } = loadSettings();

  // Las publicaciones ya se registran en publish-service; aquí solo faltan los avisos
  if (event.type === 'warning') {
    logger.warning(event.message, event.detail);
  }

  const entry = {
    text: `${icons[event.type] || '🔔'} [${formatClock(timezone)}] ${event.message}`,
    detail: event.detail,
  };

  notifications.unshift(entry);
  notifications.splice(3);

  console.log(`\n\n🔔 ${entry.text}`);
  if (entry.detail) console.log(`   └─ ${entry.detail}`);
}

// ─── Vista previa ───────────────────────────────────────────────

function formatKB(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

function showPreview(prepared, extraLines = []) {
  console.log('\n════════════════ VISTA PREVIA ════════════════');
  console.log(prepared.text);
  console.log('──────────────────────────────────────────────');
  console.log(`📏 Caracteres: ${prepared.length}/${prepared.maxLength}`);
  if (prepared.found.hashtags.length) console.log(`🏷️  Hashtags: ${prepared.found.hashtags.join(', ')}`);
  if (prepared.found.mentions.length) console.log(`👥 Menciones: ${prepared.found.mentions.join(', ')}`);
  if (prepared.found.links.length) console.log(`🔗 Enlaces: ${prepared.found.links.join(', ')}`);

  if (prepared.image) {
    const { image } = prepared;
    const reduced = image.size < image.originalSize
      ? ` (reducida desde ${formatKB(image.originalSize)})`
      : '';
    console.log(`🖼️  Imagen: ${image.width}x${image.height}, ${formatKB(image.size)}${reduced}`);
    console.log(`   Descripción: ${image.alt || '(sin descripción)'}`);
  }

  prepared.warnings.forEach((warning) => console.log(`⚠️  ${warning}`));
  extraLines.forEach((line) => console.log(line));
  console.log('══════════════════════════════════════════════');
}

// ─── Pedir y preparar un post ───────────────────────────────────

async function askPostData() {
  const postData = {};
  postData.text = await ask('📝 Texto del post: ');
  postData.hashtags = await ask('🏷️  Hashtags (ej: #bot #prueba) o ENTER para omitir: ');
  postData.mentions = await ask('👥 Menciones (ej: @usuario.bsky.social) o ENTER para omitir: ');

  if (await askYesNo('🖼️  ¿Agregar imagen?')) {
    postData.imageSource = await ask('📎 URL de la imagen o ruta del archivo en tu PC: ');
    postData.imageAlt = await ask('📝 Descripción de la imagen o ENTER para omitir: ');
  }

  return postData;
}

// Devuelve { postData, prepared }, o null si el post tiene errores
async function askAndPrepare(publisher) {
  const postData = await askPostData();

  console.log('\n⏳ Preparando el post...');
  const prepared = await publisher.prepare(postData);

  if (!prepared.valid) {
    console.log('\n❌ El post tiene errores:');
    prepared.errors.forEach((error) => console.log(`   - ${error}`));
    await pause();
    return null;
  }

  return { postData, prepared };
}

// ─── 1. Publicar ahora ──────────────────────────────────────────

async function publishNow() {
  const publisher = getCurrentPublisher();

  showHeader('📝 PUBLICAR AHORA');
  console.log(`🎯 Plataforma: ${publisher.name}\n`);

  const input = await askAndPrepare(publisher);
  if (!input) return;

  const extraLines = [];
  if (publisher.id !== 'simulacion') {
    const { dailyLimit, timezone } = loadSettings();
    extraLines.push(`📊 Hoy llevas ${history.countRealToday(timezone)} de ${dailyLimit} publicaciones reales`);
  }

  showPreview(input.prepared, extraLines);

  if (!(await askYesNo('\n✅ ¿Publicar ahora?'))) {
    console.log('❌ Cancelado');
    await pause();
    return;
  }

  console.log('\n📤 Publicando...');
  const result = await publishPrepared({
    publisher,
    prepared: input.prepared,
    source: 'inmediata',
  });

  if (result.simulated) {
    console.log('\n🧪 Simulación completada: no se publicó nada real');
    console.log(`   ID de prueba: ${result.id}`);
  } else {
    console.log('\n🎉 ¡Publicado!');
    console.log(`🔗 ${result.url}`);
  }

  await pause();
}

// ─── 2. Programar publicación ───────────────────────────────────

async function schedulePostFlow() {
  const publisher = getCurrentPublisher();
  const { timezone } = loadSettings();

  showHeader('⏰ PROGRAMAR PUBLICACIÓN');
  console.log(`🎯 Plataforma: ${publisher.name} | 🌍 Zona horaria: ${timezone}\n`);

  const input = await askAndPrepare(publisher);
  if (!input) return;

  const date = parseDateInput(await ask('\n📅 Fecha (hoy, mañana o 25/10/2026): '), timezone);
  if (!date) {
    console.log('❌ Fecha no válida');
    await pause();
    return;
  }

  const time = parseTimeInput(await ask('🕐 Hora (ej: 2:30 PM o 14:30): '));
  if (!time) {
    console.log('❌ Hora no válida');
    await pause();
    return;
  }

  const scheduledAt = toInstant(date, time, timezone);
  if (!scheduledAt || Date.parse(scheduledAt) <= Date.now()) {
    console.log('❌ Esa fecha y hora ya pasaron');
    await pause();
    return;
  }

  showPreview(input.prepared, [
    `📅 Se publicará: ${formatDateTime(scheduledAt, timezone)} (${relativeTime(scheduledAt)})`,
  ]);

  if (!(await askYesNo('\n✅ ¿Confirmar programación?'))) {
    console.log('❌ Cancelado');
    await pause();
    return;
  }

  const post = scheduler.schedulePost({
    postData: input.postData,
    image: input.prepared.image,
    scheduledAt,
    platform: publisher.id,
  });

  logger.info(`Publicación programada ${post.id}`, { platform: post.platform, scheduledAt });

  console.log(`\n🎉 Publicación programada con ID ${post.id}`);
  console.log('💡 El bot debe estar abierto a esa hora para que se publique.');
  await pause();
}

// ─── 3. Ver programadas ─────────────────────────────────────────

async function cancelFlow(pending) {
  if (pending.length === 0) {
    console.log('📭 No hay nada que cancelar');
    await pause();
    return;
  }

  const number = Number(await ask('Número de la publicación a cancelar: '));
  const post = pending[number - 1];

  if (!post) {
    console.log('❌ Número inválido');
    await pause();
    return;
  }

  if (!(await askYesNo(`¿Cancelar [${post.id}] "${shorten(post.postData.text, 30)}"?`))) return;

  const result = scheduler.cancelPost(post.id);
  if (result.success) logger.info(`Publicación programada ${post.id} cancelada`);

  console.log(result.success ? '✅ Publicación cancelada' : `❌ ${result.error}`);
  await pause();
}

async function showScheduled() {
  while (true) {
    const { timezone } = loadSettings();
    const pending = scheduler.getPending();
    const recent = scheduler.getRecent(5);

    showHeader('📋 PUBLICACIONES PROGRAMADAS');

    if (pending.length === 0) {
      console.log('📭 No hay publicaciones pendientes');
    }

    pending.forEach((post, index) => {
      const extras = [`🎯 ${platformName(post.platform)}`];
      if (post.imageFile) extras.push('🖼️ con imagen');

      console.log(`${index + 1}. [${post.id}] ${shorten(post.postData.text, 45)}`);
      console.log(`   📅 ${formatDateTime(post.scheduledAt, timezone)} (${relativeTime(post.scheduledAt)}) | ${extras.join(' | ')}`);
    });

    if (recent.length > 0) {
      console.log('\n🕘 Últimas finalizadas:');
      recent.forEach((post) => {
        console.log(`   ${STATUS_LABELS[post.status] || post.status} [${post.id}] ${shorten(post.postData.text, 35)}`);
        if (post.result?.url) console.log(`      └─ ${post.result.url}`);
        if (post.error) console.log(`      └─ ${post.error}`);
      });
    }

    console.log('\n1. 🚫 Cancelar una publicación');
    console.log('0. 🔙 Volver\n');

    const choice = await ask('Elige una opción: ');

    if (choice === '0') return;

    if (choice === '1') {
      await cancelFlow(pending);
    } else {
      console.log('❌ Opción inválida');
      await pause();
    }
  }
}

// ─── 4. Recurrentes ─────────────────────────────────────────────

async function createRecurringFlow() {
  const publisher = getCurrentPublisher();
  const { timezone } = loadSettings();

  showHeader('➕ NUEVA PUBLICACIÓN RECURRENTE');
  console.log(`🎯 Plataforma: ${publisher.name} | 🌍 Zona horaria: ${timezone}\n`);

  const input = await askAndPrepare(publisher);
  if (!input) return;

  console.log('\n🔄 ¿Cada cuánto se repite?');
  console.log('1. Todos los días');
  console.log('2. Ciertos días de la semana');
  console.log('3. Ciertos días del mes');

  const frequency = { 1: 'diaria', 2: 'semanal', 3: 'mensual' }[await ask('Elige: ')];
  if (!frequency) {
    console.log('❌ Opción inválida');
    await pause();
    return;
  }

  const rule = { frequency, timezone, days: [] };

  if (frequency === 'semanal') {
    console.log('\nL=lunes, M=martes, X=miércoles, J=jueves, V=viernes, S=sábado, D=domingo');
    rule.days = recurring.parseWeekdays(await ask('¿Qué días? (ej: L, X, V): '));
  } else if (frequency === 'mensual') {
    rule.days = recurring.parseMonthDays(await ask('\n¿Qué días del mes? (ej: 1, 15): '));
  }

  if (!rule.days) {
    console.log('❌ Días no válidos');
    await pause();
    return;
  }

  rule.time = parseTimeInput(await ask('🕐 Hora (ej: 9:00 AM o 21:30): '));
  if (!rule.time) {
    console.log('❌ Hora no válida');
    await pause();
    return;
  }

  const firstRun = recurring.computeNextRun(rule, new Date().toISOString());

  showPreview(input.prepared, [
    `🔄 Se repetirá: ${recurring.describeRule(rule)}`,
    `📅 Primera publicación: ${formatDateTime(firstRun, timezone)} (${relativeTime(firstRun)})`,
  ]);

  if (!(await askYesNo('\n✅ ¿Crear esta recurrencia?'))) {
    console.log('❌ Cancelado');
    await pause();
    return;
  }

  const item = recurring.createRecurring({
    postData: input.postData,
    image: input.prepared.image,
    platform: publisher.id,
    rule,
  });

  logger.info(`Recurrencia ${item.id} creada`, { platform: item.platform, regla: recurring.describeRule(rule) });

  console.log(`\n🎉 Recurrencia creada con ID ${item.id}`);
  console.log('💡 El bot debe estar abierto para que se publique.');
  await pause();
}

async function chooseRecurring(items, action) {
  if (items.length === 0) {
    console.log('📭 No hay recurrencias');
    await pause();
    return null;
  }

  const number = Number(await ask(`Número de la recurrencia a ${action}: `));
  const item = items[number - 1];

  if (!item) {
    console.log('❌ Número inválido');
    await pause();
    return null;
  }
  return item;
}

async function toggleRecurringFlow(items) {
  const item = await chooseRecurring(items, 'pausar o activar');
  if (!item) return;

  const result = recurring.toggleRecurring(item.id);

  if (!result.success) {
    console.log(`❌ ${result.error}`);
  } else if (result.status === 'pausada') {
    logger.info(`Recurrencia ${item.id} pausada`);
    console.log(`⏸️  ${item.id} pausada`);
  } else {
    logger.info(`Recurrencia ${item.id} activada`);
    console.log(`▶️  ${item.id} activada. Próxima: ${relativeTime(result.nextRunAt)}`);
  }
  await pause();
}

async function deleteRecurringFlow(items) {
  const item = await chooseRecurring(items, 'eliminar');
  if (!item) return;

  if (!(await askYesNo(`¿Eliminar [${item.id}] "${shorten(item.postData.text, 30)}"?`))) return;

  const result = recurring.deleteRecurring(item.id);
  if (result.success) logger.info(`Recurrencia ${item.id} eliminada`);

  console.log(result.success ? '✅ Recurrencia eliminada' : `❌ ${result.error}`);
  await pause();
}

async function showRecurring() {
  while (true) {
    const items = recurring.getAll();

    showHeader('🔄 PUBLICACIONES RECURRENTES');

    if (items.length === 0) {
      console.log('📭 No hay publicaciones recurrentes\n');
    }

    items.forEach((item, index) => {
      const status = item.status === 'activa' ? '🟢 Activa' : '⏸️  Pausada';
      const extras = [`🎯 ${platformName(item.platform)}`];
      if (item.imageFile) extras.push('🖼️ con imagen');

      console.log(`${index + 1}. [${item.id}] ${status} — ${shorten(item.postData.text, 40)}`);
      console.log(`   🔄 ${recurring.describeRule(item.rule)}`);
      console.log(`   ${extras.join(' | ')} | 📊 Publicada ${item.runCount} ${item.runCount === 1 ? 'vez' : 'veces'}`);

      if (item.status === 'activa') {
        console.log(`   ⏭️  Próxima: ${formatDateTime(item.nextRunAt, item.rule.timezone)} (${relativeTime(item.nextRunAt)})`);
      }

      if (item.lastResult) {
        const label = RESULT_LABELS[item.lastResult.status] || item.lastResult.status;
        console.log(`   ${label} ${relativeTime(item.lastResult.at)}`);
        if (item.lastResult.url) console.log(`      └─ ${item.lastResult.url}`);
        if (item.lastResult.error) console.log(`      └─ ${item.lastResult.error}`);
      }

      console.log('');
    });

    console.log('1. ➕ Crear recurrencia');
    console.log('2. ⏯️  Pausar / activar');
    console.log('3. ❌ Eliminar');
    console.log('0. 🔙 Volver\n');

    const choice = await ask('Elige una opción: ');

    if (choice === '0') return;

    if (choice === '1') {
      await createRecurringFlow();
    } else if (choice === '2') {
      await toggleRecurringFlow(items);
    } else if (choice === '3') {
      await deleteRecurringFlow(items);
    } else {
      console.log('❌ Opción inválida');
      await pause();
    }
  }
}

// ─── 5. Estadísticas ────────────────────────────────────────────

async function showStats() {
  const settings = loadSettings();
  const stats = history.getStats(settings.timezone);
  const { today, week, month } = stats.periods;

  showHeader('📊 ESTADÍSTICAS');

  console.log(`${''.padEnd(15)}${'Reales'.padStart(8)}${'Simuladas'.padStart(12)}${'Errores'.padStart(10)}`);
  [['Hoy', today], ['Esta semana', week], ['Este mes', month]].forEach(([label, period]) => {
    console.log(
      `${label.padEnd(15)}${String(period.real).padStart(8)}${String(period.simulated).padStart(12)}${String(period.errors).padStart(10)}`
    );
  });

  console.log(`\n📏 Límite diario: ${today.real}/${settings.dailyLimit} publicaciones reales hoy`);

  const s = stats.bySource;
  console.log(`📂 Este mes por origen (incluye simuladas): ${s.inmediata} inmediatas | ${s.programada} programadas | ${s.recurrente} recurrentes`);

  if (stats.lastReal) {
    console.log(`\n🕘 Última publicación real ${relativeTime(stats.lastReal.at)}: "${shorten(stats.lastReal.text, 40)}"`);
    if (stats.lastReal.url) console.log(`   └─ ${stats.lastReal.url}`);
  }

  if (stats.recentErrors.length > 0) {
    console.log('\n❌ Últimos errores:');
    stats.recentErrors.forEach((entry) => {
      console.log(`   ${relativeTime(entry.at)} [${entry.sourceId || entry.source}] ${shorten(entry.error, 60)}`);
    });
  }

  console.log(`\n⏰ Programadas pendientes: ${scheduler.getPending().length} | 🔄 Recurrentes activas: ${recurring.getActive().length}`);
  console.log(`📁 Registro de hoy: logs/${logger.getTodayLogName()}`);

  await pause();
}

// ─── 6. Configuración ───────────────────────────────────────────

async function choosePlatform() {
  const publishers = listPublishers();

  console.log('\nPlataformas disponibles:\n');
  publishers.forEach((publisher, index) => {
    console.log(`${index + 1}. ${publisher.name} — ${publisher.description}`);
  });

  const choice = Number(await ask('\nElige un número: '));
  const chosen = publishers[choice - 1];

  if (!chosen) {
    console.log('❌ Opción inválida');
    await pause();
    return;
  }

  // Se verifica antes de guardar: si las credenciales fallan, la plataforma no cambia
  console.log(`\n🔐 Verificando ${chosen.name}...`);
  const status = await chosen.verify();

  const settings = loadSettings();
  settings.platform = chosen.id;
  saveSettings(settings);
  logger.info(`Plataforma cambiada a ${chosen.name}`);

  console.log(`✅ Plataforma cambiada a ${chosen.name}: ${status}`);
  console.log('💡 Las programadas y recurrentes ya creadas conservan la plataforma con la que se crearon.');
  await pause();
}

async function chooseTimezone() {
  console.log('\nZonas horarias comunes:\n');
  COMMON_TIMEZONES.forEach((zone, index) => console.log(`${index + 1}. ${zone}`));
  console.log('M. Escribir otra (formato Continente/Ciudad)');

  const choice = (await ask('\nElige: ')).toUpperCase();
  const zone = choice === 'M'
    ? await ask('Zona horaria: ')
    : COMMON_TIMEZONES[Number(choice) - 1];

  if (!isValidZone(zone)) {
    console.log('❌ Zona horaria no válida');
    await pause();
    return;
  }

  const settings = loadSettings();
  settings.timezone = zone;
  saveSettings(settings);
  logger.info(`Zona horaria cambiada a ${zone}`);

  console.log(`✅ Zona horaria cambiada a ${zone}`);
  console.log('💡 Las programadas y recurrentes ya creadas conservan la zona horaria con la que se crearon.');
  await pause();
}

async function chooseDailyLimit() {
  const settings = loadSettings();

  console.log(`\nLímite actual: ${settings.dailyLimit} publicaciones reales por día`);
  console.log('💡 Es un freno de seguridad: al alcanzarlo, el bot no publica más ese día.');
  console.log('   Las simulaciones no cuentan.');

  const value = Number(await ask('\nNuevo límite (1 a 500): '));

  if (!Number.isInteger(value) || value < 1 || value > 500) {
    console.log('❌ Debe ser un número entero entre 1 y 500');
    await pause();
    return;
  }

  settings.dailyLimit = value;
  saveSettings(settings);
  logger.info(`Límite diario cambiado a ${value}`);

  console.log(`✅ Límite diario: ${value}`);
  await pause();
}

async function showSettings() {
  while (true) {
    const settings = loadSettings();

    showHeader('⚙️  CONFIGURACIÓN');
    console.log(`🎯 Plataforma actual: ${getCurrentPublisher().name}`);
    console.log(`🌍 Zona horaria actual: ${settings.timezone}`);
    console.log(`📏 Límite diario actual: ${settings.dailyLimit}\n`);
    console.log('1. Cambiar plataforma');
    console.log('2. Cambiar zona horaria');
    console.log('3. Cambiar límite diario');
    console.log('0. 🔙 Volver\n');

    const choice = await ask('Elige una opción: ');

    if (choice === '0') return;

    if (choice === '1') {
      await choosePlatform();
    } else if (choice === '2') {
      await chooseTimezone();
    } else if (choice === '3') {
      await chooseDailyLimit();
    } else {
      console.log('❌ Opción inválida');
      await pause();
    }
  }
}

// ─── Menú principal ─────────────────────────────────────────────

function showMainStatus() {
  const settings = loadSettings();
  console.log(`🎯 Plataforma: ${getCurrentPublisher().name} | 🌍 Zona horaria: ${settings.timezone}`);

  const pending = scheduler.getPending();
  if (pending.length > 0) {
    const next = pending[0];
    console.log(`⏰ Programadas: ${pending.length} | Próxima ${relativeTime(next.scheduledAt)}: "${shorten(next.postData.text, 30)}"`);
  }

  const active = recurring.getActive();
  if (active.length > 0) {
    const next = active[0];
    console.log(`🔄 Recurrentes activas: ${active.length} | Próxima ${relativeTime(next.nextRunAt)}: "${shorten(next.postData.text, 30)}"`);
  }

  if (notifications.length > 0) {
    console.log('\n🔔 Avisos recientes:');
    notifications.forEach((notification) => {
      console.log(`   ${notification.text}`);
      if (notification.detail) console.log(`      └─ ${notification.detail}`);
    });
  }

  console.log('');
}

async function confirmExit() {
  const pendingCount = scheduler.getPending().length;
  const activeCount = recurring.getActive().length;

  if (pendingCount === 0 && activeCount === 0) return true;

  console.log('\n⚠️  Mientras el bot esté cerrado:');
  if (pendingCount > 0) console.log(`   • No se publicarán tus ${pendingCount} programada(s).`);
  if (activeCount > 0) console.log(`   • No se ejecutarán tus ${activeCount} recurrente(s).`);
  console.log('   Lo que tenga más de 15 minutos de retraso al volver a abrirlo no se publicará.');

  return askYesNo('\n¿Salir de todas formas?');
}

async function startMenu() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Ctrl + C cierra el bot limpiamente
  rl.on('SIGINT', () => {
    logger.info('Bot detenido con Ctrl + C');
    console.log('\n\n👋 Bot detenido');
    process.exit(0);
  });

  logger.info('Bot iniciado', { platform: loadSettings().platform });
  scheduler.startScheduler(handleBackgroundEvent);
  recurring.startRecurring(handleBackgroundEvent);

  try {
    while (true) {
      showHeader('🤖 BOT DE PUBLICACIONES');
      showMainStatus();
      console.log('1. 📝 Publicar ahora');
      console.log('2. ⏰ Programar publicación');
      console.log('3. 📋 Ver programadas');
      console.log('4. 🔄 Recurrentes');
      console.log('5. 📊 Estadísticas');
      console.log('6. ⚙️  Configuración');
      console.log('0. 🚪 Salir\n');

      const choice = await ask('Elige una opción: ');

      if (choice === '0') {
        if (await confirmExit()) {
          console.log('\n👋 ¡Hasta luego!');
          return;
        }
        continue;
      }

      // Si algo falla dentro de una opción, se muestra el error y se vuelve al menú
      try {
        if (choice === '1') {
          await publishNow();
        } else if (choice === '2') {
          await schedulePostFlow();
        } else if (choice === '3') {
          await showScheduled();
        } else if (choice === '4') {
          await showRecurring();
        } else if (choice === '5') {
          await showStats();
        } else if (choice === '6') {
          await showSettings();
        } else {
          console.log('❌ Opción inválida');
          await pause();
        }
      } catch (error) {
        console.log(`\n❌ ${error.message}`);
        await pause();
      }
    }
  } finally {
    logger.info('Bot detenido');
    scheduler.stopScheduler();
    recurring.stopRecurring();
    rl.close();
  }
}

module.exports = { startMenu };