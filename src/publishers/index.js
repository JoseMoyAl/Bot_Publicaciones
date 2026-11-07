const bluesky = require('./bluesky');
const simulation = require('./simulation');

// Para agregar otra red (por ejemplo X), se crea su archivo con las mismas
// funciones (verify, prepare, publish) y se registra en esta lista
const PUBLISHERS = [bluesky, simulation];

function getPublisher(id) {
  return PUBLISHERS.find((publisher) => publisher.id === id) || null;
}

function listPublishers() {
  return PUBLISHERS;
}

module.exports = { getPublisher, listPublishers };