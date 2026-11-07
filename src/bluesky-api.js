const { getBlueskyCredentials } = require('./config');

const SERVICE = 'https://bsky.social';

const ERROR_HINTS = {
  400: 'Petición inválida: revisa el formato de los datos enviados.',
  401: 'Usuario o contraseña de aplicación incorrectos.',
  413: 'El archivo es demasiado grande para Bluesky.',
  429: 'Demasiados intentos seguidos: espera unos minutos.',
};

class BlueskyApiError extends Error {
  constructor(status, body) {
    const detail = body?.message || body?.error || JSON.stringify(body);
    const hint = ERROR_HINTS[status] || 'Error inesperado de la API.';
    super(`Error ${status}: ${hint}\n   Respuesta de Bluesky: ${detail}`);
    this.status = status;
    this.body = body;
  }
}

// body: datos que se envían como JSON
// binary + contentType: bytes de un archivo (por ejemplo, una imagen)
async function request(method, endpoint, { token, body, query, binary, contentType } = {}) {
  let url = `${SERVICE}/xrpc/${endpoint}`;
  if (query) url += `?${new URLSearchParams(query)}`;

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (binary) {
    headers['Content-Type'] = contentType;
    payload = binary;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, { method, headers, body: payload });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new BlueskyApiError(response.status, data);
  }

  return data;
}

// Inicia sesión. Devuelve accessJwt (el token para las demás peticiones),
// refreshJwt (para renovarlo), did (tu ID) y handle
async function createSession() {
  const { handle, appPassword } = getBlueskyCredentials();
  return request('POST', 'com.atproto.server.createSession', {
    body: { identifier: handle, password: appPassword },
  });
}

// Renueva el token vencido usando refreshJwt, sin volver a enviar la contraseña
async function refreshSession(session) {
  return request('POST', 'com.atproto.server.refreshSession', {
    token: session.refreshJwt,
  });
}

async function getProfile(session) {
  return request('GET', 'app.bsky.actor.getProfile', {
    token: session.accessJwt,
    query: { actor: session.did },
  });
}

// Convierte un usuario (ana.bsky.social) en su ID permanente (did:plc:...).
// Devuelve null si el usuario no existe.
async function resolveHandle(handle) {
  try {
    const data = await request('GET', 'com.atproto.identity.resolveHandle', {
      query: { handle },
    });
    return data.did;
  } catch (error) {
    if (error.status === 400) return null;
    throw error;
  }
}

// Sube los bytes de la imagen. Bluesky devuelve una referencia (blob) que luego se adjunta al post.
async function uploadImage(session, image) {
  const data = await request('POST', 'com.atproto.repo.uploadBlob', {
    token: session.accessJwt,
    binary: image.data,
    contentType: image.mimeType,
  });
  return data.blob;
}

// Publicar = guardar un registro nuevo en la colección de posts de tu repositorio.
// image (opcional): { blob, alt, width, height }
async function createPost(session, { text, facets = [], image = null }) {
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    langs: ['es'],
    createdAt: new Date().toISOString(),
  };

  if (facets.length > 0) {
    record.facets = facets;
  }

  if (image) {
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: [{
        alt: image.alt || '',
        image: image.blob,
        aspectRatio: { width: image.width, height: image.height },
      }],
    };
  }

  return request('POST', 'com.atproto.repo.createRecord', {
    token: session.accessJwt,
    body: {
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    },
  });
}

// Bluesky devuelve una dirección interna (at://did/coleccion/ID).
// Con el ID del final se arma el enlace normal para verlo en el navegador.
function getPostUrl(handle, uri) {
  const postId = uri.split('/').pop();
  return `https://bsky.app/profile/${handle}/post/${postId}`;
}

module.exports = {
  createSession,
  refreshSession,
  getProfile,
  resolveHandle,
  uploadImage,
  createPost,
  getPostUrl,
  BlueskyApiError,
};