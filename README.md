# Bot de publicaicones

Bot de línea de comandos en Node.js para publicar, programar y repetir publicaciones en **Bluesky**, con soporte de imágenes, validación de contenido, historial y estadísticas. La arquitectura permite agregar otras redes sociales sin modificar el resto del código.

## Funcionalidades

- **Publicar ahora** con vista previa antes de confirmar.
- **Programar publicaciones** para una fecha y hora específicas, que se conservan aunque se cierre el bot.
- **Publicaciones recurrentes**: diarias, ciertos días de la semana o ciertos días del mes. Se pueden pausar, reactivar y eliminar.
- **Imágenes** desde una URL (incluye enlaces de Google Drive) o desde un archivo local. Se comprimen automáticamente al límite de 1 MB de Bluesky.
- **Hashtags, menciones y enlaces clickeables**. Las menciones se verifican contra Bluesky antes de publicar.
- **Validación** de longitud (300 caracteres visibles), formato de hashtags y menciones.
- **Modo simulación**: ejecuta todo el proceso sin publicar nada.
- **Límite diario configurable** como freno de seguridad.
- **Historial, estadísticas y logs diarios** de todas las publicaciones.
- **Zona horaria configurable**.

## Tecnologías

- **Node.js** (sin frameworks)
- **AT Protocol / API de Bluesky**
- **OAuth 1.0a** implementado manualmente con firma HMAC-SHA1 (para la API de X)
- **sharp**: procesamiento y compresión de imágenes
- **luxon**: manejo de fechas y zonas horarias

## Requisitos

- Node.js 20.12 o superior
- Una cuenta de Bluesky con una contraseña de aplicación

## Instalación

```bash
git clone https://github.com/JoseMoyAl/social-post-bot.git
cd social-post-bot
npm install
```

Crea el archivo de credenciales a partir de la plantilla:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

## Configuración

1. En Bluesky ve a **Configuración → Privacidad y seguridad → Contraseñas de aplicación** y genera una nueva.
2. Escribe tus datos en `.env`:

```
BLUESKY_HANDLE=tuusuario.bsky.social
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

3. Verifica la conexión:

```bash
npm run verificar-bluesky
```

Sin credenciales, el bot funciona en **modo simulación**, que es la plataforma por defecto.

## Uso

```bash
npm start
```

```
══════════════════════════════════════════════════
🤖 BOT DE PUBLICACIONES
══════════════════════════════════════════════════

🎯 Plataforma: Bluesky | 🌍 Zona horaria: America/Guatemala
⏰ Programadas: 2 | Próxima en 3 horas: "Nuevo artículo en el blog"
🔄 Recurrentes activas: 1 | Próxima en 14 horas: "¡Buenos días!"

1. 📝 Publicar ahora
2. ⏰ Programar publicación
3. 📋 Ver programadas
4. 🔄 Recurrentes
5. 📊 Estadísticas
6. ⚙️  Configuración
0. 🚪 Salir
```

La plataforma, la zona horaria y el límite diario se cambian desde **Configuración**.

## Estructura del proyecto

```
src/
├── bot.js               # Punto de entrada
├── menu.js              # Interfaz de línea de comandos
├── publish-service.js   # Punto único de publicación: límite, historial y logs
├── scheduler.js         # Publicaciones programadas
├── recurring.js         # Publicaciones recurrentes y cálculo de fechas
├── post-builder.js      # Prepara un post: validación, imagen y facets
├── validator.js         # Reglas de validación del texto
├── rich-text.js         # Detección de hashtags, menciones y enlaces
├── images.js            # Descarga, lectura y compresión de imágenes
├── publishers/          # Una implementación por plataforma
│   ├── bluesky.js
│   ├── simulation.js
│   └── index.js
├── bluesky-api.js       # Cliente de la API de Bluesky
├── x-api.js             # Cliente de la API de X
├── oauth.js             # Firma OAuth 1.0a
├── history.js           # Historial y estadísticas
├── logger.js            # Logs diarios en archivo
├── settings.js          # Configuración persistente
├── storage.js           # Lectura y escritura segura de JSON
├── time.js              # Fechas, horas y zonas horarias
└── config.js            # Carga de credenciales desde .env
```

## Decisiones de diseño

- **Plataformas intercambiables.** Cada red social implementa las mismas tres funciones (`verify`, `prepare` y `publish`). El menú no sabe a qué plataforma publica, así que agregar una nueva solo requiere un archivo en `publishers/`.
- **Sin publicaciones duplicadas.** Un post programado se marca como `publicando` antes de enviarse, y una recurrencia calcula su siguiente fecha antes de publicar. Si el proceso se interrumpe, nada se reintenta a ciegas.
- **Fechas en UTC.** Las publicaciones guardan el momento exacto en UTC y se convierten a la zona horaria solo al mostrarse. Cambiar la zona horaria no altera lo ya programado.
- **Escritura atómica.** Los archivos JSON se escriben primero en un archivo temporal que después se renombra, así un cierre inesperado nunca deja un archivo a medias.
- **Sesión reutilizable.** La sesión de Bluesky se mantiene en memoria y se renueva automáticamente cuando el token vence, sin volver a enviar la contraseña.
- **Posiciones en bytes.** Bluesky ubica hashtags, menciones y enlaces por posición en bytes UTF-8, no en caracteres, por lo que los textos con acentos o emojis se marcan correctamente.
- **Firma OAuth 1.0a propia.** La firma para la API de X está implementada sin librerías y se verificó contra el ejemplo oficial de la documentación.

## Limitaciones

- Las publicaciones programadas y recurrentes solo se ejecutan **mientras el bot está abierto**. Si al volver a abrirlo una publicación lleva más de 15 minutos de retraso, se descarta para no publicar fuera de contexto.
- La integración con **X** incluye autenticación y verificación de credenciales, pero no la publicación, porque la API de X requiere créditos de pago.
- Una imagen por publicación.

## Autor

**José Moises Alvarez Salazar** · [GitHub](https://github.com/JoseMoyAl)

---

© 2026 José Moises Alvarez Salazar. Todos los derechos reservados. Este código se publica como muestra de portafolio; no se permite su uso, copia ni distribución sin autorización.
