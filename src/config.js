const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

// Si no hay .env, el bot igual arranca (por ejemplo, en modo simulación).
// Cada plataforma avisa qué le falta cuando se intenta usar.
try {
  process.loadEnvFile(ENV_PATH);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// Un valor cuenta como vacío si no existe o si sigue siendo el texto de ejemplo
function isMissing(value) {
  return !value || value.startsWith('tu_') || value.startsWith('pega_aqui');
}

function readVars(platform, names) {
  const missing = names.filter((name) => isMissing(process.env[name]));
  if (missing.length > 0) {
    throw new Error(`Faltan credenciales de ${platform} en el archivo .env: ${missing.join(', ')}`);
  }
  return names.map((name) => process.env[name].trim());
}

function getBlueskyCredentials() {
  const [handle, appPassword] = readVars('Bluesky', ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD']);
  return { handle: handle.replace(/^@/, ''), appPassword };
}

function getXCredentials() {
  const [apiKey, apiSecret, accessToken, accessTokenSecret] = readVars('X', [
    'API_KEY',
    'API_SECRET_KEY',
    'ACCESS_TOKEN',
    'ACCESS_TOKEN_SECRET',
  ]);
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

module.exports = { getBlueskyCredentials, getXCredentials };