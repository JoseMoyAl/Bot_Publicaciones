const { getPublisher } = require('./publishers');
const { loadSettings } = require('./settings');
const history = require('./history');
const logger = require('./logger');

function isSimulation(publisher) {
  return publisher?.id === 'simulacion';
}

function describe(source, sourceId) {
  return sourceId ? `${source} ${sourceId}` : source;
}

// Freno de seguridad: evita publicar de más por error. Las simulaciones no cuentan.
function checkDailyLimit(publisher) {
  if (isSimulation(publisher)) return;

  const { dailyLimit, timezone } = loadSettings();
  const today = history.countRealToday(timezone);

  if (today >= dailyLimit) {
    throw new Error(`Límite diario alcanzado (${today}/${dailyLimit} publicaciones reales hoy). Puedes cambiarlo en Configuración.`);
  }
}

function recordFailure({ publisher, platformId, text, source, sourceId, error }) {
  history.record({
    status: 'error',
    platform: publisher?.id || platformId,
    simulated: isSimulation(publisher),
    source,
    sourceId,
    text,
    error: error.message,
  });
  logger.error(`Falló la publicación ${describe(source, sourceId)}`, { error: error.message });
}

// Publica un post ya preparado. Lo usa "Publicar ahora", que muestra la vista previa antes.
async function publishPrepared({ publisher, prepared, source, sourceId = null }) {
  try {
    checkDailyLimit(publisher);
    const result = await publisher.publish(prepared);

    history.record({
      status: 'publicado',
      platform: publisher.id,
      simulated: isSimulation(publisher),
      source,
      sourceId,
      text: prepared.text,
      url: result.url,
      postId: result.id,
    });
    logger.success(`Publicación ${describe(source, sourceId)} en ${publisher.name}`, { url: result.url || result.id });

    return result;
  } catch (error) {
    recordFailure({ publisher, text: prepared.text, source, sourceId, error });
    throw error;
  }
}

// Prepara y publica en un solo paso. Lo usan las programadas y las recurrentes.
async function publishPost({ platformId, postData, source, sourceId }) {
  const publisher = getPublisher(platformId);
  let prepared;

  try {
    if (!publisher) {
      throw new Error(`La plataforma "${platformId}" no existe`);
    }

    prepared = await publisher.prepare(postData);

    if (!prepared.valid) {
      throw new Error(prepared.errors.join('; '));
    }
  } catch (error) {
    recordFailure({ publisher, platformId, text: postData.text, source, sourceId, error });
    throw error;
  }

  return publishPrepared({ publisher, prepared, source, sourceId });
}

module.exports = { publishPrepared, publishPost };