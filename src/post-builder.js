const { validatePost } = require('./validator');
const { buildFacets } = require('./rich-text');
const { loadImage, prepareImage } = require('./images');

// Convierte lo que escribió el usuario en un post listo para publicar:
// valida el texto, procesa la imagen y detecta hashtags, menciones y enlaces.
// postData: { text, hashtags, mentions, imageSource, imageAlt }
async function preparePost(postData, resolveHandle) {
  const validation = validatePost(postData);

  if (!validation.valid) {
    return { valid: false, errors: validation.errors };
  }

  let image = null;
  if (postData.imageSource && postData.imageSource.trim()) {
    try {
      image = await prepareImage(await loadImage(postData.imageSource));
      image.alt = (postData.imageAlt || '').trim();
    } catch (error) {
      return { valid: false, errors: [`Imagen: ${error.message}`] };
    }
  }

  const { facets, warnings, found } = await buildFacets(validation.fullText, resolveHandle);

  return {
    valid: true,
    errors: [],
    warnings,
    text: validation.fullText,
    length: validation.length,
    maxLength: validation.maxLength,
    facets,
    found,
    image,
  };
}

module.exports = { preparePost };