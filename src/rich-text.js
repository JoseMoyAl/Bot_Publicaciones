// Bluesky no detecta solo los hashtags, menciones y enlaces: hay que indicarle
// en qué posición (en bytes) está cada uno. Esas marcas se llaman "facets".

function byteIndex(text, charIndex) {
  return Buffer.byteLength(text.slice(0, charIndex), 'utf8');
}

function makeFacet(text, start, end, feature) {
  return {
    index: { byteStart: byteIndex(text, start), byteEnd: byteIndex(text, end) },
    features: [feature],
  };
}

function findLinks(text) {
  const results = [];
  const regex = /https?:\/\/[^\s]+/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Quita la puntuación pegada al final: "mira https://bsky.app." no incluye el punto
    const url = match[0].replace(/[.,;:!?)"']+$/, '');
    results.push({ start: match.index, end: match.index + url.length, url });
  }
  return results;
}

function findHashtags(text) {
  const results = [];
  const regex = /(^|\s)#([\p{L}\p{N}_]+)/gu;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const tag = match[2];
    if (!/[\p{L}_]/u.test(tag)) continue; // #2024 solo con números no es hashtag

    const start = match.index + match[1].length;
    results.push({ start, end: start + 1 + tag.length, tag });
  }
  return results;
}

function findMentions(text) {
  const results = [];
  const regex = /(^|\s)@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const handle = match[2];
    const start = match.index + match[1].length;
    results.push({ start, end: start + 1 + handle.length, handle: handle.toLowerCase() });
  }
  return results;
}

// resolveHandle se recibe como parámetro para que este archivo no dependa
// de la API: solo sabe trabajar con texto
async function buildFacets(text, resolveHandle) {
  const facets = [];
  const warnings = [];
  const found = { links: [], hashtags: [], mentions: [] };

  for (const link of findLinks(text)) {
    facets.push(makeFacet(text, link.start, link.end, {
      $type: 'app.bsky.richtext.facet#link',
      uri: link.url,
    }));
    found.links.push(link.url);
  }

  for (const hashtag of findHashtags(text)) {
    facets.push(makeFacet(text, hashtag.start, hashtag.end, {
      $type: 'app.bsky.richtext.facet#tag',
      tag: hashtag.tag,
    }));
    found.hashtags.push(`#${hashtag.tag}`);
  }

  for (const mention of findMentions(text)) {
    const did = await resolveHandle(mention.handle);

    if (did) {
      facets.push(makeFacet(text, mention.start, mention.end, {
        $type: 'app.bsky.richtext.facet#mention',
        did,
      }));
      found.mentions.push(`@${mention.handle}`);
    } else {
      warnings.push(`@${mention.handle} no existe en Bluesky: quedará como texto normal`);
    }
  }

  return { facets, warnings, found };
}

module.exports = { buildFacets };