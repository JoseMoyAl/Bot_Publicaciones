const { startMenu } = require('./menu');

startMenu().catch((error) => {
  console.error('\n💥 Error inesperado:', error);
  process.exitCode = 1;
});