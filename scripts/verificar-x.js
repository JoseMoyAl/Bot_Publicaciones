async function main() {
  console.log('🔐 Verificando credenciales con X...\n');

  try {
    // El require va dentro del try para atrapar también los errores del .env
    const { getMe } = require('../src/x-api');
    const user = await getMe();
    console.log(`✅ Conectado como @${user.username} (${user.name})`);
  } catch (error) {
    console.log(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

main();