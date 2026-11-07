const fs = require('fs/promises');
const sharp = require('sharp');

const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // 20 MB: lo máximo que aceptamos leer o descargar
const MAX_UPLOAD_BYTES = 950 * 1000;       // Bluesky acepta hasta 1,000,000 bytes; dejamos margen
const MAX_DIMENSION = 2000;                // Lado más largo, en píxeles

// Convierte enlaces "para ver" en enlaces directos a la imagen:
// - Google Drive: .../file/d/ID/view  →  descarga directa
// - Google Imágenes: ...imgres?imgurl=URL_REAL  →  URL_REAL
function normalizeImageUrl(input) {
  const driveMatch = input.match(/drive\.google\.com\/file\/d\/([\w-]+)/)
    || input.match(/drive\.google\.com\/.*[?&]id=([\w-]+)/);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  try {
    const realUrl = new URL(input).searchParams.get('imgurl');
    if (realUrl) return realUrl;
  } catch {
    // No es una URL válida; fetch dará el error correspondiente
  }

  return input;
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen (error ${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('text/html')) {
    throw new Error('El enlace abre una página web, no una imagen. Si es de Google Drive, verifica que el archivo sea público.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error('La imagen pesa más de 20 MB');
  }

  return buffer;
}

async function readLocalImage(filePath) {
  // Windows agrega comillas al usar "Copiar como ruta de acceso"
  const cleanPath = filePath.replace(/^["']|["']$/g, '');

  let stats;
  try {
    stats = await fs.stat(cleanPath);
  } catch {
    throw new Error(`No existe el archivo: ${cleanPath}`);
  }

  if (!stats.isFile()) throw new Error(`No es un archivo: ${cleanPath}`);
  if (stats.size > MAX_SOURCE_BYTES) throw new Error('La imagen pesa más de 20 MB');

  return fs.readFile(cleanPath);
}

// Acepta una URL (http/https) o la ruta de un archivo en tu PC
async function loadImage(source) {
  const input = source.trim();
  if (/^https?:\/\//i.test(input)) {
    return downloadImage(normalizeImageUrl(input));
  }
  return readLocalImage(input);
}

// Convierte la imagen a JPEG y baja la calidad (y si hace falta, el tamaño) hasta que pese menos de 1 MB.
// rotate() endereza las fotos de celular; flatten() pone fondo blanco a los PNG transparentes,
// que en JPEG quedarían con fondo negro.
async function prepareImage(buffer) {
  try {
    await sharp(buffer).metadata();
  } catch {
    throw new Error('El archivo no es una imagen válida o su formato no es compatible');
  }

  let maxDimension = MAX_DIMENSION;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const quality of [85, 75, 65, 55]) {
      const { data, info } = await sharp(buffer)
        .rotate()
        .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      if (data.length <= MAX_UPLOAD_BYTES) {
        return {
          data,
          mimeType: 'image/jpeg',
          width: info.width,
          height: info.height,
          size: data.length,
          originalSize: buffer.length,
        };
      }
    }
    maxDimension = Math.round(maxDimension * 0.75);
  }

  throw new Error('No se pudo reducir la imagen por debajo de 1 MB');
}

module.exports = { loadImage, prepareImage };