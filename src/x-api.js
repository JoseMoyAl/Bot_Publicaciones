const { getXCredentials } = require('./config');
const { buildAuthHeader } = require('./oauth');

const API_BASE = 'https://api.x.com/2';

const ERROR_HINTS = {
  401: 'Credenciales incorrectas, o la hora de tu computadora está desfasada.',
  402: 'Pago requerido: revisa tu saldo de créditos en la Developer Console.',
  403: 'Sin permiso: la app necesita permisos de lectura y escritura.',
  429: 'Demasiadas peticiones seguidas: espera unos minutos.',
};

class XApiError extends Error {
  constructor(status, body) {
    const detail = body?.detail || body?.title || JSON.stringify(body);
    const hint = ERROR_HINTS[status] || 'Error inesperado de la API.';
    super(`Error ${status}: ${hint}\n   Respuesta de X: ${detail}`);
    this.status = status;
    this.body = body;
  }
}

async function getMe() {
  const url = `${API_BASE}/users/me`;

  const response = await fetch(url, {
    headers: { Authorization: buildAuthHeader('GET', url, getXCredentials()) },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new XApiError(response.status, body);
  }

  return body.data;
}

module.exports = { getMe, XApiError };