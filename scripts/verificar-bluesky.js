async function main() {
  console.log('🦋 Verificando conexión con Bluesky...\n');

  try {
    const { createSession, getProfile } = require('../src/bluesky-api');
    const session = await createSession();
    const profile = await getProfile(session);

    const name = profile.displayName ? ` (${profile.displayName})` : '';
    console.log(`✅ Conectado como @${profile.handle}${name}`);
    console.log(`   Seguidores: ${profile.followersCount ?? 0} | Publicaciones: ${profile.postsCount ?? 0}`);
  } catch (error) {
    console.log(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

main();