const MAX_LENGTH = 300;
const MAX_TAG_LENGTH = 64;

// Bluesky cuenta caracteres visibles: un emoji como 👍🏽 cuenta como 1,
// aunque internamente esté formado por varios códigos
const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' });

function countGraphemes(text) {
  return Array.from(segmenter.segment(text)).length;
}

// Acepta elementos separados por espacios o comas: "#uno #dos", "uno, dos"
function splitInput(input) {
  if (!input || !input.trim()) return [];
  return input.split(/[\s,]+/).filter(Boolean);
}

function parseHashtags(input) {
  const tags = [];
  const errors = [];

  for (const raw of splitInput(input)) {
    const tag = raw.replace(/^#+/, '');

    if (!/^[\p{L}\p{N}_]+$/u.test(tag)) {
      errors.push(`Hashtag inválido: "${raw}" (solo letras, números y _)`);
      continue;
    }
    if (!/[\p{L}_]/u.test(tag)) {
      errors.push(`Hashtag inválido: "${raw}" (debe tener al menos una letra)`);
      continue;
    }
    if (countGraphemes(tag) > MAX_TAG_LENGTH) {
      errors.push(`Hashtag demasiado largo: "${raw}" (máximo ${MAX_TAG_LENGTH} caracteres)`);
      continue;
    }

    const formatted = `#${tag}`;
    if (!tags.includes(formatted)) tags.push(formatted);
  }

  return { tags, errors };
}

// En Bluesky los usuarios tienen forma de dominio: @ana.bsky.social
// Si escribes solo "ana", se asume ana.bsky.social
function parseMentions(input) {
  const mentions = [];
  const errors = [];

  for (const raw of splitInput(input)) {
    let handle = raw.replace(/^@+/, '').toLowerCase();
    if (!handle.includes('.')) handle += '.bsky.social';

    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(handle)) {
      errors.push(`Mención inválida: "${raw}"`);
      continue;
    }

    const formatted = `@${handle}`;
    if (!mentions.includes(formatted)) mentions.push(formatted);
  }

  return { mentions, errors };
}

// Orden final del post: menciones + texto + hashtags
function buildFullText({ text = '', hashtags = '', mentions = '' }) {
  return [
    parseMentions(mentions).mentions.join(' '),
    text.trim(),
    parseHashtags(hashtags).tags.join(' '),
  ].filter(Boolean).join(' ');
}

function validatePost(postData) {
  const errors = [];

  if (!(postData.text || '').trim()) {
    errors.push('El texto no puede estar vacío');
  }

  const hashtags = parseHashtags(postData.hashtags);
  const mentions = parseMentions(postData.mentions);
  errors.push(...hashtags.errors, ...mentions.errors);

  const fullText = buildFullText(postData);
  const length = countGraphemes(fullText);

  if (length > MAX_LENGTH) {
    errors.push(`El texto tiene ${length} caracteres (máximo ${MAX_LENGTH})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    fullText,
    length,
    maxLength: MAX_LENGTH,
  };
}

module.exports = {
  MAX_LENGTH,
  countGraphemes,
  parseHashtags,
  parseMentions,
  buildFullText,
  validatePost,
};