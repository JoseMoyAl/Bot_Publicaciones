const { preparePost } = require('../post-builder');

// No se conecta a ninguna red: da todas las menciones por válidas
async function fakeResolveHandle() {
  return 'did:plc:simulado';
}

async function verify() {
  return 'sin conexión (modo simulación)';
}

async function prepare(postData) {
  const prepared = await preparePost(postData, fakeResolveHandle);

  if (prepared.valid && prepared.found.mentions.length > 0) {
    prepared.warnings.push('Modo simulación: no se verifica si las menciones existen');
  }

  return prepared;
}

async function publish() {
  return {
    simulated: true,
    id: `SIM-${Date.now()}`,
    url: null,
  };
}

module.exports = {
  id: 'simulacion',
  name: 'Simulación',
  description: 'Hace todo el proceso pero no publica nada',
  verify,
  prepare,
  publish,
};