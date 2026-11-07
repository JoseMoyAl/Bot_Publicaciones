const { readJson, writeJson } = require('./storage');
const { isValidZone } = require('./time');

const FILE = 'settings.json';

const DEFAULT_SETTINGS = {
  platform: 'simulacion',
  timezone: 'America/Guatemala',
  dailyLimit: 20,
};

function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS, ...readJson(FILE, {}) };

  if (!isValidZone(settings.timezone)) {
    settings.timezone = DEFAULT_SETTINGS.timezone;
  }

  const limit = settings.dailyLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    settings.dailyLimit = DEFAULT_SETTINGS.dailyLimit;
  }

  return settings;
}

function saveSettings(settings) {
  writeJson(FILE, settings);
}

module.exports = { loadSettings, saveSettings };