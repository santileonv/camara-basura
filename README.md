# Detector de basura XIAO · Railway y PostgreSQL

Versión 3.0.0 · TALLER DISEÑO · 14 de noviembre de 2026.

La XIAO ESP32-S3 Sense envía fotografías JPEG por Internet al servidor de Railway. El servidor mantiene cargado el modelo de Teachable Machine, analiza las capturas, combina las probabilidades de residuos y guarda cada medición en PostgreSQL. La página web permite consultar el resultado y el historial desde otra red, incluso desde los datos móviles del teléfono. La detección continúa con la página cerrada.

Esta entrega utiliza GitHub como origen del código y Railway para ejecutar el servidor y PostgreSQL. En tu cuenta ya se creó el proyecto **Taller-Diseno-XIAO**, con PostgreSQL en línea y el servicio web configurado. **El servicio web todavía no tiene un despliegue de código**: falta subir los archivos a un repositorio privado y conectarlo al servicio existente. No se han borrado recursos ni registros anteriores de Vercel o Neon.

## Estado de tu proyecto creado

| Recurso | Identificación y estado comprobado |
|---|---|
| Proyecto | `Taller-Diseno-XIAO` · `8a09dbaa-0204-48ec-bd38-abd6aaa4ea0f`. |
| Entorno | `production` · `1fef8631-bec4-4a08-b37a-407f3a325014`. |
| PostgreSQL | `Postgres` · `af3991a4-cb98-4995-bb77-68804b4f67e7` · despliegue SUCCESS, con volumen. |
| Servicio web | `xiao-monitor` · `455ab1d7-ec8b-4c87-ac72-6ba2fe7734de` · creado, configurado, sin código desplegado. |
| Dominio reservado | `https://xiao-monitor-production.up.railway.app` · todavía no sirve la aplicación. |
| Configuración | Raíz `/app`, ocho variables definidas, referencia interna de PostgreSQL, puerto 3000, Dockerfile, una réplica y healthcheck `/healthz`. |
| Acceso | Clave del monitor y token de cámara generados y configurados; se entregan por separado en `Config_XIAO_Railway.txt`. |

No crees otro proyecto ni otra base si continúas con los recursos de esta tabla. Los apartados de creación siguientes también sirven para reproducir la instalación desde cero.

Para terminar en este proyecto con GitHub:

1. Crea un repositorio privado, por ejemplo `xiao-detector-basura`, en tu cuenta de GitHub.
2. Extrae el ZIP y sube el contenido de `XIAO_Railway_Remoto`: `app`, `firmware`, README y los demás archivos del paquete. En la raíz del repositorio debe verse `app`, y dentro `app/package.json`, `app/Dockerfile` y `app/model/weights.bin`.
3. Puedes usar la opción de GitHub **Add file → Upload files** y arrastrar archivos y carpetas. En un repositorio vacío, usa el enlace para subir archivos existentes. Confirma la subida en la rama `main`.
4. Utiliza una extracción limpia del ZIP. Mantén fuera del repositorio `Config_XIAO_Railway.txt`, `config.h`, archivos `.env` con claves y `node_modules`. Si subes por el navegador, revisa los archivos seleccionados: no dependas de `.gitignore` para excluirlos.
5. En Railway abre **Taller-Diseno-XIAO → xiao-monitor → Settings → Source → Connect Repo**. Conecta tu cuenta GitHub si lo solicita y concede acceso al repositorio del proyecto. Selecciona ese repositorio y la rama `main`.
6. Comprueba **Root Directory: `/app`**. Ya quedó ajustado en el servicio para esta estructura. Conserva `Dockerfile` como ruta del Dockerfile y `/healthz` como ruta de salud.
7. Revisa **Variables**: la conexión de PostgreSQL y las claves ya están configuradas. Conserva sus valores.
8. Aplica los cambios y despliega si Railway lo solicita. Espera a que el despliegue termine en **SUCCESS**, verifica `/healthz` y entra al monitor. Después configura y carga la XIAO como explica el apartado 7.

Este método de despliegue no requiere instalar la CLI de Railway ni ejecutar `railway up`. Los cambios que subas a la rama conectada se desplegarán automáticamente mientras el despliegue automático esté habilitado. Cambiar el firmware guardado en GitHub no actualiza por sí solo la placa: el sketch se sigue cargando mediante Arduino IDE.

Que se anuncie una subida o un build no significa que esté listo: comprueba que el despliegue termine en **SUCCESS** y que `/healthz` responda correctamente. Las tablas se crearán en el primer arranque exitoso del servidor. No se ha ejecutado una copia de datos de una base anterior porque no se proporcionó su conexión.

## 1. Qué incluye

| Archivo o carpeta | Función |
|---|---|
| `app/server.js` | Arranque del servidor, tablas, modelo, rutas y cierre ordenado. |
| `app/Dockerfile` | Entorno Node 22 reproducible para Railway. |
| `app/lib/database.js` | Conexiones PostgreSQL con el controlador `pg`. |
| `app/database/schema.sql` | Tablas, restricciones e índice del historial. |
| `app/lib/model.js` y `app/model/` | Modelo entrenado, pesos y procesamiento de imágenes. |
| `app/lib/decision.js` | Suma de clases, promedio y confirmación de basura. |
| `app/lib/store.js` | Registro atómico de mediciones, estado y paginación. |
| `app/public/` | Monitor, inicio de sesión, historial y exportación CSV. |
| `app/scripts/import-history.js` | Copia opcional de la base anterior a una base nueva. |
| `app/test/` | Pruebas de detección, PostgreSQL, migración y servidor HTTP. |
| `firmware/XIAO_Remota/` | Sketch de la cámara, configuración de ejemplo y certificados. |

La versión anterior utilizaba funciones de Vercel y el conector de Neon. Esta utiliza un servidor Node persistente y PostgreSQL directamente. El modelo entrenado y las clases se conservan. No necesitas generar `assets.h`.

## 2. Preparar el proyecto

1. Descomprime el ZIP y conserva toda la carpeta, incluidos el modelo y sus pesos.
2. Sube el contenido de `XIAO_Railway_Remoto` a un repositorio privado de GitHub. En la raíz del repositorio deben quedar `app`, `firmware` y este README.
3. No subas `config.h`, archivos `.env` ni contraseñas. Los archivos de ejemplo sí se incluyen.
4. Puedes usar el mismo modelo de esta entrega; no hace falta volver a entrenarlo.

Con esta estructura, Railway utiliza `/app` como raíz del servicio. Conserva las carpetas y los pesos del modelo al subir el proyecto; el ZIP comprimido por sí solo no es el código fuente que Railway necesita construir.

## 3. Crear PostgreSQL en Railway

1. En Railway, crea un proyecto para el detector.
2. Añade un servicio de base de datos **PostgreSQL** desde la plantilla oficial.
3. Espera a que termine de desplegarse y comprueba que tiene su volumen de datos.
4. Conserva sus variables automáticas. El servidor utilizará su `DATABASE_URL` interna.

Las tres tablas se crean automáticamente cuando inicia la aplicación. No hace falta copiar el SQL a mano. El archivo SQL se incluye para documentar el esquema y para consultas administrativas. Repetir el arranque no elimina información.

| Tabla | Qué conserva |
|---|---|
| `camaras` | Identificación de la cámara; inicialmente `camara-1`. |
| `estado_camara` | Última captura, miniatura, ventana de promedio y revisión. |
| `mediciones` | Una fila por captura aceptada, con fecha, porcentajes y conclusión. |

La cámara no accede a la base de datos. Envía las fotos a la API HTTPS; solo el servidor se conecta a PostgreSQL. No necesitas publicar el puerto de PostgreSQL para este funcionamiento.

## 4. Crear el servicio web

1. En tu proyecto ya creado, abre **xiao-monitor** y conecta el repositorio desde **Settings → Source → Connect Repo**. Si reproduces la instalación desde cero, crea el servicio web en el mismo proyecto de PostgreSQL.
2. En **Settings → Source**, establece **Root Directory: `/app`** si subiste la estructura del apartado 2.
3. Railway detectará el `Dockerfile` de esa carpeta. El arranque está definido como `node server.js`.
4. Configura **una réplica** para este prototipo. La recepción limita a una imagen en análisis a la vez por instancia.
5. En la configuración de despliegue, establece **Healthcheck Path: `/healthz`**. El servidor responde correctamente cuando el modelo ya está preparado y PostgreSQL responde.
6. Mantén desactivada la suspensión del servicio si quieres que el modelo permanezca listo continuamente.

No hace falta definir `PORT`: Railway lo inyecta y el servidor escucha en `0.0.0.0`. No se utilizan archivos antiguos `vercel.json`, `railway.json` ni `railway.toml`.

## 5. Variables del servicio web

Configúralas en **Variables** del servicio web, no en el código del navegador.

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Referencia a `DATABASE_URL` del servicio PostgreSQL del mismo proyecto. |
| `CAMERA_TOKEN` | Clave aleatoria de al menos 32 caracteres; debe coincidir con la XIAO. |
| `DASHBOARD_PASSWORD` | Clave para entrar a la web, de al menos 12 caracteres. |
| `SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres para firmar sesiones. |
| `NODE_ENV` | `production`. |
| `THRESHOLD` | `0.80`. |
| `STALE_AFTER_SECONDS` | `90`. |

Para `DATABASE_URL`, usa **Add Reference Variable** y selecciona el PostgreSQL del proyecto. Si el servicio se llama `Postgres`, la referencia puede verse así:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Usa el nombre real que aparece en tu proyecto. La conexión interna solo funciona desde Railway; no la pruebes desde tu PC como si fuera una dirección pública.

Puedes generar las tres claves desde tu PC, dentro de `app`:

```bash
node scripts/secrets.js
```

El comando muestra claves nuevas cada vez. Guarda las elegidas y no vuelvas a generarlas para una cámara ya configurada sin actualizar también su token. No compartas las claves por capturas de pantalla ni las publiques en GitHub.

## 6. Publicar y comprobar la web

1. Guarda las variables y despliega el servicio.
2. Revisa los registros. Deben terminar con `Servidor listo` y confirmar que el modelo y PostgreSQL están preparados.
3. En **Settings → Networking → Public Networking**, pulsa **Generate Domain**.
4. Abre la dirección HTTPS que entregue Railway. Esa es la dirección del monitor.
5. Abre la misma dirección seguida de `/healthz`. Debe devolver `{"ok":true}`.
6. Entra al monitor con `DASHBOARD_PASSWORD`. Antes de conectar la cámara aparecerá sin capturas recientes y con el historial vacío.

La URL tendrá un formato parecido a `https://TU_PROYECTO.up.railway.app`. Es un ejemplo, no una dirección creada para ti. Usa exactamente el dominio que genere tu despliegue.

## 7. Conectar la XIAO

1. Abre `firmware/XIAO_Remota/XIAO_Remota.ino` en Arduino IDE.
2. Copia `config.example.h` como `config.h` en la misma carpeta.
3. Completa estos cuatro valores:

```cpp
static const char *WIFI_SSID = "NOMBRE_DE_TU_WIFI";
static const char *WIFI_PASSWORD = "CONTRASENA_DE_TU_WIFI";
static const char *SERVER_URL = "https://TU_DOMINIO_REAL.up.railway.app/api/ingest";
static const char *CAMERA_TOKEN = "MISMO_TOKEN_CONFIGURADO_EN_RAILWAY";
```

4. Usa una red WiFi de **2,4 GHz** con acceso a Internet.
5. Selecciona la placa **XIAO_ESP32S3**, **OPI PSRAM** y **USB CDC On Boot: Enabled**. El sketch mantiene la cámara y los pines de la versión anterior, orientada a Arduino-ESP32 3.3.x.
6. Carga el sketch y abre el monitor serie a **115200 baudios**.
7. Espera la conexión WiFi y la sincronización de hora por NTP. La hora permite validar el certificado HTTPS.
8. Comprueba que aparezca `HTTP 200`, seguido del resultado enviado por el servidor.

El envío contiene JPEG binario, un token y un identificador de captura. La conexión comprueba el certificado y el nombre del servidor; no usa `setInsecure()`.

El WiFi sigue configurándose en `config.h`. Esta entrega no implementa todavía un portal para seleccionar redes desde el teléfono o la página remota.

## 8. Qué hace la detección

1. La cámara obtiene una imagen de **800 × 600** y la envía por HTTPS.
2. El servidor recorta el cuadrado central de **600 × 600**, lo reduce a **224 × 224** y aplica la misma normalización del modelo de Teachable Machine.
3. El modelo entrega las probabilidades de **Sin basura**, **Botellas**, **Papeles y Cartones** y **Bolsas**.
4. El sistema suma Botellas + Papeles y Cartones + Bolsas. Así, un objeto puede alternar entre clases de residuos sin impedir la conclusión conjunta.
5. Promedia hasta cinco capturas recientes. Empieza a evaluar con tres capturas y exige tres confirmaciones consecutivas.
6. Con umbral de 80 %, concluye **Hay basura** si el promedio conjunto es ≥80 %, **Sin basura** si es ≤20 % y **No seguro** en la zona intermedia o durante la confirmación.
7. El nuevo estado y la medición se guardan juntos en PostgreSQL. Si falla la escritura, no se da por guardado un estado parcial.

Con evidencia consistente, la primera conclusión confirmada llega en la quinta captura. Un reinicio de la cámara, un corte largo o un cambio de umbral reinician la ventana de confirmación. Refrescar la web no añade mediciones.

La pausa de captura es de **15 segundos después de terminar cada envío**. El tiempo de red y análisis se suma a esa pausa. No son 15 segundos exactos entre mediciones ni se transmite vídeo continuo. Si un envío falla, la cámara espera al menos 30 segundos antes de otra captura; no almacena una cola de fotos perdidas durante un corte.

Si pasan 90 segundos sin una lectura, el monitor indica **Sin datos recientes**. El historial anterior sigue disponible. Los porcentajes son puntuaciones de clasificación; no expresan volumen, cantidad de objetos ni una medición física de basura.

## 9. Consultar el historial desde cualquier lugar

Abre el dominio público de Railway y entra con tu clave. Puedes hacerlo desde una red diferente a la de la cámara.

- El estado actual se consulta aproximadamente cada 15 segundos mientras la pestaña está visible.
- El historial se carga por páginas y puedes pulsar **Actualizar historial** para incorporar nuevas filas.
- **Cargar más registros** recupera registros anteriores.
- El CSV incluye únicamente las filas cargadas en pantalla. Para exportar todo, carga todas las páginas primero.
- Las fechas de pantalla usan la zona horaria del dispositivo; el CSV incluye fechas UTC.

Se guardan los resultados numéricos de todas las capturas aceptadas. Solo se conserva la miniatura de la última captura en `estado_camara`; esta entrega no archiva todas las fotografías.

## 10. Trasladar datos anteriores de Neon u otro PostgreSQL

Este paso es opcional. Si nunca desplegaste la base anterior o no tienes mediciones, empieza con la base nueva. No hay registros que copiar.

El importador espera el esquema PostgreSQL de la versión 2 de este proyecto: `camaras`, `estado_camara` y `mediciones`. Una base Upstash/Redis necesita otra conversión; esta herramienta no importa Redis.

1. Apaga temporalmente la XIAO para que la base anterior deje de recibir capturas. Conserva Vercel y Neon mientras verificas el traspaso.
2. Despliega el servicio web nuevo y verifica que la base de destino no tenga mediciones ni estados. El importador se negará a sobrescribir un destino con información.
3. Añade temporalmente **solo al servicio web** la variable `SOURCE_DATABASE_URL` con la conexión de la base anterior. Conserva `DATABASE_URL` apuntando al PostgreSQL nuevo. No uses la misma base como origen y destino.
4. Instala la CLI oficial si hace falta: `npm install -g @railway/cli`, y autentícate con `railway login`.
5. En el panel de Railway, abre el menú del servicio web y copia su comando SSH con **Copy SSH Command**. Ejecútalo en tu terminal. Es una sesión dentro del contenedor de Railway.
6. Dentro de esa sesión ejecuta:

```bash
cd /app
npm run db:import
```

7. Espera `Importacion completada` y revisa los conteos de cámaras, mediciones y estados. Si hay un fallo, el destino revierte la copia; el origen permanece de solo lectura.
8. Comprueba en el monitor fechas y resultados de varios registros. Se conservan los IDs y los datos; la secuencia de IDs queda preparada para las nuevas capturas.
9. Elimina la variable temporal `SOURCE_DATABASE_URL` del servicio web y vuelve a desplegar si Railway lo solicita.
10. Actualiza la XIAO con la URL de Railway y su token, enciéndela y confirma que se añaden nuevas filas.

No ejecutes `railway run npm run db:import` desde tu PC con la URL privada: ese comando corre localmente y no equivale a estar dentro de Railway. Usa SSH para alcanzar la base interna.

El importador copia el contenido completo en una transacción de destino y puede bloquear brevemente las consultas de esas tablas. La cámara debe permanecer detenida hasta que termine. Está pensado para el historial de este prototipo, no para una migración sin interrupciones de una base muy grande.

El traslado de archivos no copia por sí mismo datos reales de una cuenta anterior. Para ejecutar esta importación se necesitan ambas conexiones y acceso al servicio de destino. Ningún recurso anterior se elimina automáticamente.

## 11. Desarrollo y pruebas

Requiere Node 22. Desde `app`:

```bash
npm ci
npm test
npm run check-model
```

Para ejecutar el servidor localmente, copia `.env.example` como `.env`, completa las variables con una conexión PostgreSQL accesible desde tu equipo y usa `NODE_ENV=development` para una sesión HTTP local:

```bash
npm run dev
```

Abre `http://localhost:3000`. Para producción mantén `NODE_ENV=production` y HTTPS. Las cookies de producción son `Secure`, `HttpOnly` y `SameSite=Strict`.

Las pruebas usan PostgreSQL compilado a WebAssembly mediante PGlite: no necesitan tus credenciales ni escriben en tus bases de nube. Incluyen ejecución real del modelo con un JPEG sintético, recorrido HTTP, acceso protegido, registro atómico, duplicados, paginación, copia de más de 250 registros y reversión ante fallos. La imagen sintética comprueba ejecución; no mide la precisión con basura real.

El paquete no incluye `node_modules`. Docker instala solo dependencias de producción con `npm ci`. No se ha compilado el sketch ni probado una cámara física desde este entorno.

## 12. Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| El servicio no inicia | Variables obligatorias, referencia de `DATABASE_URL`, raíz `/app` y registros de arranque. |
| Healthcheck falla | PostgreSQL aún arrancando, conexión incorrecta o modelo ausente. El servidor escucha después de preparar ambos. |
| XIAO devuelve HTTP 401 | `CAMERA_TOKEN` distinto entre el servicio y `config.h`. |
| HTTP 429 | Hay una captura en análisis. Se rechaza la adicional para evitar acumular imágenes en memoria. |
| HTTP 413 o 415 | Imagen demasiado grande o contenido que no es JPEG válido. |
| HTTP 503 | Fallo del análisis o de PostgreSQL; revisar los registros de Railway. |
| Error de HTTPS | URL correcta, hora NTP y cadena de certificados; no desactivar la verificación como solución. |
| No entra al monitor | Clave de acceso correcta y `NODE_ENV=production` con el dominio HTTPS. |
| Sin datos recientes | Cámara sin conexión, servicio detenido, token incorrecto o más de 90 s sin lecturas. |
| No aparecen filas nuevas en historial | Pulsa Actualizar historial; el estado actual y la tabla se refrescan por separado. |
| Importación cancelada | Destino ocupado, esquema anterior incompatible o conexiones incorrectas; no se borra el destino para forzar la copia. |

## 13. Librerías y funciones clave

| Elemento | Uso |
|---|---|
| `@tensorflow/tfjs` 4.22.0 | Inferencia del modelo en CPU en el servidor. |
| `sharp` 0.35.5 | Validación JPEG, recorte, reducción y miniatura. |
| `pg` 8.23.1 | Pool de conexiones y consultas parametrizadas PostgreSQL. |
| `@electric-sql/pglite` 0.5.16 | PostgreSQL para las pruebas de desarrollo. |
| `node:http`, `node:crypto`, `node:fs` | Servidor, firma de sesión y lectura de archivos; incluidos en Node. |
| `WiFi`, `esp_camera`, `esp_http_client`, `time` | Red, cámara, HTTPS y hora; incluidos en el entorno Arduino-ESP32. |
| `loadModel()` / `classify()` | Carga una vez el modelo por proceso y analiza imágenes. |
| `decide()` | Obtiene la conclusión conjunta y aplica las confirmaciones. |
| `saveReading()` / `readHistory()` | Guarda una captura y recupera páginas de historial. |
| `migrate()` | Prepara las tablas al arrancar con bloqueo de migración. |
| `importHistory()` | Copia datos PostgreSQL sin modificar el origen. |
| `CAPTURE_INTERVAL_MS` | Pausa de la XIAO entre envíos terminados; 15000 ms por defecto. |
| `THRESHOLD` / `STALE_AFTER_SECONDS` | Umbral de decisión y antigüedad máxima de una lectura actual. |

## 14. Operación y referencias

Railway cobra el uso del servicio y de la base según el plan y los créditos disponibles; esta entrega no garantiza alojamiento gratuito permanente. Consulta tu panel antes de mantener el sistema encendido de forma continua. El historial crece con cada captura; puedes configurar copias de seguridad del volumen de PostgreSQL en Railway.

Documentación oficial de referencia:

- PostgreSQL: https://docs.railway.com/guides/postgresql
- Dockerfiles: https://docs.railway.com/builds/dockerfiles
- Healthchecks: https://docs.railway.com/guides/healthchecks
- CLI y SSH: https://docs.railway.com/cli/ssh
- Variables: https://docs.railway.com/guides/variables

