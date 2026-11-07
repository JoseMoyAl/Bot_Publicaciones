const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(fileName, defaultValue) {
  const filePath = path.join(DATA_DIR, fileName);

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(defaultValue);
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const backupPath = `${filePath}.danado-${Date.now()}`;
    fs.renameSync(filePath, backupPath);
    console.log(`⚠️ ${fileName} estaba dañado. Se guardó una copia como ${path.basename(backupPath)} y se usaron valores por defecto.`);
    return structuredClone(defaultValue);
  }
}

function writeJson(fileName, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const filePath = path.join(DATA_DIR, fileName);
  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

module.exports = { DATA_DIR, readJson, writeJson };