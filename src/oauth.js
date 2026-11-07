const crypto = require('crypto');

// encodeURIComponent deja sin codificar ! ' ( ) *, pero OAuth exige codificarlos
function percentEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase()
  );
}

function createSignature(method, url, params, apiSecret, accessTokenSecret) {
  // 1. Parámetros ordenados alfabéticamente: clave=valor&clave=valor
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  // 2. El contenido a firmar: método + URL + parámetros
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;

  // 3. La llave: tus dos secretos unidos con &
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;

  // 4. El sello
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(method, url, credentials) {
  const oauthParams = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  oauthParams.oauth_signature = createSignature(
    method,
    url,
    oauthParams,
    credentials.apiSecret,
    credentials.accessTokenSecret
  );

  const headerParams = Object.keys(oauthParams)
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${headerParams}`;
}

module.exports = { percentEncode, createSignature, buildAuthHeader };