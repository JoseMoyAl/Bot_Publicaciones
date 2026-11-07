const api = require('../bluesky-api');
const { preparePost } = require('../post-builder');

// La sesión se guarda en memoria para no iniciar sesión en cada publicación:
// Bluesky limita cuántos inicios de sesión permite por hora.
let session = null;

function isExpiredToken(error) {
  return ['ExpiredToken', 'InvalidToken'].includes(error.body?.error);
}

// Ejecuta una acción con la sesión activa.
// Si el token venció, lo renueva y reintenta una sola vez.
async function withSession(action) {
  if (!session) {
    session = await api.createSession();
  }

  try {
    return await action(session);
  } catch (error) {
    if (!isExpiredToken(error)) throw error;

    try {
      session = await api.refreshSession(session);
    } catch {
      session = await api.createSession();
    }
    return action(session);
  }
}

async function verify() {
  return withSession(async (current) => `@${current.handle}`);
}

async function prepare(postData) {
  return preparePost(postData, api.resolveHandle);
}

async function publish(prepared) {
  return withSession(async (current) => {
    let image = null;

    if (prepared.image) {
      const blob = await api.uploadImage(current, prepared.image);
      image = {
        blob,
        alt: prepared.image.alt,
        width: prepared.image.width,
        height: prepared.image.height,
      };
    }

    const result = await api.createPost(current, {
      text: prepared.text,
      facets: prepared.facets,
      image,
    });

    return {
      simulated: false,
      id: result.uri,
      url: api.getPostUrl(current.handle, result.uri),
    };
  });
}

module.exports = {
  id: 'bluesky',
  name: 'Bluesky',
  description: 'Publica de verdad en tu cuenta de Bluesky',
  verify,
  prepare,
  publish,
};