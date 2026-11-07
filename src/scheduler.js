const fs = require('fs');
const path = require('path');
const { readJson, writeJson, DATA_DIR } = require('./storage');
const { publishPost } = require('./publish-service');

const FILE = 'scheduled.json';
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const CHECK_INTERVAL_MS = 30 * 1000;
const MAX_DELAY_MINUTES = 15;
const HISTORY_LIMIT = 50;

let timer = null;
let checking = false;
let notify = () => {};

// ─── Lectura y escritura ────────────────────────────────────────

function load() {
  return readJson(FILE, { nextId: 1, posts: [] });
}

function save(data) {
  writeJson(FILE, data);
}

// Siempre se vuelve a leer el archivo antes de modificar, para no borrar
// cambios hechos desde el menú mientras se publicaba otro post
function updatePost(id, changes) {
  const data = load();
  const post = data.posts.find((p) => p.id === id);
  if (post) {
    Object.assign(post, changes);
    save(data);
  }
  return post;
}

function removeImage(post) {
  if (post.imageFile) {
    fs.rmSync(path.join(IMAGES_DIR, post.imageFile), { force: true });
  }
}

// Cierra un post (publicado, error, vencido o cancelado) y borra su imagen guardada
function finish(post, changes) {
  updatePost(post.id, { ...changes, finishedAt: new Date().toISOString() });
  removeImage(post);
}

// ─── Funciones que usa el menú ──────────────────────────────────

// Guarda la imagen ya procesada en data/images para no depender
// de que la URL o el archivo original sigan existiendo ese día
function schedulePost({ postData, image, scheduledAt, platform }) {
  const data = load();
  const id = `PROG-${data.nextId}`;
  data.nextId += 1;

  let imageFile = null;
  if (image) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    imageFile = `${id}.jpg`;
    fs.writeFileSync(path.join(IMAGES_DIR, imageFile), image.data);
  }

  const post = {
    id,
    platform,
    scheduledAt,
    status: 'pendiente',
    postData: {
      text: postData.text,
      hashtags: postData.hashtags || '',
      mentions: postData.mentions || '',
      imageAlt: postData.imageAlt || '',
    },
    imageFile,
    createdAt: new Date().toISOString(),
  };

  data.posts.push(post);
  save(data);
  return post;
}

function getPending() {
  return load().posts
    .filter((p) => p.status === 'pendiente')
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
}

function getRecent(limit = 5) {
  return load().posts
    .filter((p) => p.finishedAt)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, limit);
}

function cancelPost(id) {
  const post = load().posts.find((p) => p.id === id);

  if (!post) {
    return { success: false, error: 'No existe esa publicación' };
  }
  if (post.status !== 'pendiente') {
    return { success: false, error: `No se puede cancelar: su estado es "${post.status}"` };
  }

  finish(post, { status: 'cancelado' });
  return { success: true };
}

// ─── Publicación automática ─────────────────────────────────────

async function publishScheduled(post) {
  const delayMinutes = (Date.now() - Date.parse(post.scheduledAt)) / 60000;

  if (delayMinutes > MAX_DELAY_MINUTES) {
    finish(post, {
      status: 'vencido',
      error: `El bot estaba cerrado a la hora programada (${Math.round(delayMinutes)} min de retraso)`,
    });
    notify({
      type: 'warning',
      message: `${post.id} venció sin publicarse`,
      detail: 'El bot estaba cerrado a la hora programada',
    });
    return;
  }

  // Se marca ANTES de publicar: si el bot se cierra a la mitad,
  // este post no se vuelve a intentar y así se evitan duplicados
  updatePost(post.id, { status: 'publicando' });

  try {
    const result = await publishPost({
      platformId: post.platform,
      postData: {
        ...post.postData,
        imageSource: post.imageFile ? path.join(IMAGES_DIR, post.imageFile) : null,
      },
      source: 'programada',
      sourceId: post.id,
    });

    finish(post, { status: 'publicado', result });
    notify({
      type: 'success',
      message: `${post.id} publicado${result.simulated ? ' (simulación)' : ''}`,
      detail: result.url || result.id,
    });
  } catch (error) {
    finish(post, { status: 'error', error: error.message });
    notify({
      type: 'error',
      message: `${post.id} no se pudo publicar`,
      detail: error.message,
    });
  }
}

async function checkDuePosts() {
  // Si la revisión anterior sigue publicando, esta no arranca: así no se encima
  if (checking) return;
  checking = true;

  try {
    const due = getPending().filter((p) => Date.parse(p.scheduledAt) <= Date.now());

    for (const post of due) {
      // Se vuelve a leer por si lo cancelaron mientras se publicaba otro
      const current = load().posts.find((p) => p.id === post.id);
      if (current?.status === 'pendiente') {
        await publishScheduled(current);
      }
    }
  } catch (error) {
    notify({
      type: 'error',
      message: 'Error al revisar publicaciones programadas',
      detail: error.message,
    });
  } finally {
    checking = false;
  }
}

// Si el bot se cerró en medio de una publicación, ese post queda como error.
// No se reintenta, porque pudo haberse publicado y se duplicaría.
function recoverInterrupted() {
  const stuck = load().posts.filter((p) => p.status === 'publicando');
  stuck.forEach((post) => finish(post, {
    status: 'error',
    error: 'El bot se cerró mientras se publicaba. Revisa en la red social si llegó a publicarse.',
  }));
  return stuck.length;
}

// Conserva todos los pendientes y solo los últimos 50 finalizados
function pruneHistory() {
  const data = load();
  const active = data.posts.filter((p) => !p.finishedAt);
  const finished = data.posts
    .filter((p) => p.finishedAt)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, HISTORY_LIMIT);

  if (active.length + finished.length < data.posts.length) {
    data.posts = [...active, ...finished];
    save(data);
  }
}

function startScheduler(onEvent) {
  notify = onEvent;

  const interrupted = recoverInterrupted();
  if (interrupted > 0) {
    notify({
      type: 'warning',
      message: `${interrupted} publicación(es) quedaron a medias la última vez`,
      detail: 'Revisa en la red social si llegaron a publicarse',
    });
  }

  pruneHistory();
  checkDuePosts();
  timer = setInterval(checkDuePosts, CHECK_INTERVAL_MS);
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  schedulePost,
  getPending,
  getRecent,
  cancelPost,
  startScheduler,
  stopScheduler,
};