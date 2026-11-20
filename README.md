# Detector de basura XIAO · Railway + PostgreSQL en Aiven

Versión 3.2.0 · TALLER DISEÑO · 20 de noviembre de 2026.

La XIAO envía fotos por Internet al servidor de Railway. El servidor analiza cada imagen con el modelo de Teachable Machine, suma las probabilidades de residuos y guarda los resultados en PostgreSQL. El monitor se puede abrir desde cualquier red. La detección continúa con el navegador cerrado mientras la cámara, el servidor y la base estén encendidos.

La versión 3.2 añade un botón para invertir la cámara 180°, con la orientación aplicada tanto al análisis como a la miniatura y guardada en PostgreSQL. Conserva la descarga completa en JSON y la conexión TLS con CA de Aiven. No requiere volver a cargar el firmware.

**Estado del proyecto al 20 de noviembre:** el servicio `xiao-monitor` está conectado al repositorio `santileonv/camara-basura`, rama `main`, raíz `/app`. La migración a Aiven se completó: las 119 mediciones originales coincidieron en todos sus campos al comparar las exportaciones, se comprobaron capturas nuevas en Aiven y el usuario confirmó que el sistema funciona con el PostgreSQL antiguo de Railway apagado. Los apartados de instalación y copia siguientes sirven como referencia para reproducir el proceso; no se debe repetir la copia sobre la base que ya contiene datos.

| Componente | Dónde funciona |
|---|---|
| Firmware y cámara | XIAO ESP32-S3 Sense |
| Código del servidor | GitHub: `santileonv/camara-basura` |
| Web y análisis del modelo | Railway: `Taller-Diseno-XIAO` → `xiao-monitor` |
| Base anterior conservada, apagada | Railway: `Postgres` |
| Base de datos actual | PostgreSQL de Aiven |
| Monitor | https://xiao-monitor-production.up.railway.app |

## Orientar la cámara desde el monitor

Debajo de la última foto, **Invertir cámara · 180°** alterna entre la posición normal y una rotación de 180 grados. La elección se guarda en PostgreSQL para esa cámara y se comparte entre dispositivos; no requiere cambiar el firmware. Cuando está invertida, el botón permite **Restaurar posición normal**.

El servidor gira la imagen antes del recorte y de ejecutar el modelo. La miniatura utiliza el mismo giro. Al cambiarlo, la foto anterior se muestra girada mientras llega la nueva; los porcentajes y la conclusión esperan la captura corregida. El promedio y las confirmaciones empiezan de nuevo para evitar mezclar orientaciones. Las mediciones anteriores se conservan.

La ruta `POST /api/camera-settings` exige sesión y el mismo origen. Una versión de configuración evita que una consulta atrasada o una inferencia en curso sobrescriban la orientación elegida. Las columnas `camaras.rotacion` y `camaras.orientacion_version` se incorporan automáticamente al arrancar, con orientación inicial normal para instalaciones anteriores. El JSON mantiene los 16 campos de las mediciones; no reinterpreta resultados históricos.

## 1. Crear o seleccionar la base en Aiven

1. Entra en https://console.aiven.io/ con tu cuenta. Si aún no tienes una, completa el registro personalmente.
2. Si ya tienes un PostgreSQL de Aiven para este proyecto, úsalo; no crees uno duplicado. Para copiar datos antiguos, el destino debe estar vacío de mediciones y estados.
3. Si necesitas crear la base, selecciona **PostgreSQL** y el plan explícitamente marcado **Free / $0**. No elijas un plan de pago amparado solo por créditos de prueba. Comprueba la selección antes de crear el servicio. Si Free no está disponible en tu cuenta, detén ese paso y revisa las opciones.
4. Espera a que el servicio indique que está en ejecución. Abre sus datos de conexión y copia la **Service URI** de PostgreSQL.
5. Descarga su certificado **CA**. Abre el archivo de certificado y copia el bloque completo, desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`, con saltos de línea.
6. La URI y su contraseña se introducen únicamente en las variables privadas de Railway. No las subas a GitHub ni las pegues en el chat. El certificado CA es público, pero su valor debe corresponder al servicio.

No desactives la comprobación TLS para resolver un error. El código verifica la CA y el nombre del servidor. Si hay restricciones de IP en Aiven, revisa el acceso de Railway antes de migrar; no amplíes el acceso de red sin decidirlo expresamente.

## 2. Publicar el código mediante GitHub

1. Descarga y extrae el paquete actualizado en una carpeta aparte. Conserva tu `config.h` local y tus ajustes de WiFi.
2. En tu copia del repositorio `santileonv/camara-basura`, revisa los cambios existentes y reemplaza los archivos de `app` por esta versión. La carpeta del repositorio debe contener `app/package.json` y `app/Dockerfile`; evita crear una carpeta adicional que cambie la raíz `/app`.
3. Revisa el diff antes del commit para conservar cambios propios que hayas realizado desde la versión anterior. No necesitas reemplazar el firmware ni volver a subir el modelo si no han cambiado.
4. No incluyas `.env`, `config.h`, `Config_XIAO_Railway.txt`, contraseñas ni `node_modules`. El paquete limpio tampoco los incluye.
5. Si vas a conservar datos, apaga primero la XIAO y sigue la pausa de recepción descrita en el apartado 3 antes de reanudarla. Un push a la rama conectada puede iniciar automáticamente un despliegue y consumir recursos.
6. Sube el commit a `main` cuando corresponda desplegarlo. Railway debe conservar raíz `/app`, Dockerfile, puerto 3000 y healthcheck `/healthz`.

## 3. Copiar el historial existente sin borrarlo

Este procedimiento mantiene la base original y realiza la copia desde dentro de Railway, donde se puede alcanzar `postgres.railway.internal`. No requiere ejecutar la CLI en tu PC. Durante la operación debes mantener la cámara apagada y la recepción pausada.

### A. Preparar el origen y pausar las capturas

1. Enciende el servicio `Postgres` original en Railway usando su opción de despliegue/reanudación. No lo elimines ni crees otro volumen.
2. En **xiao-monitor → Variables**, conserva por ahora `DATABASE_URL=${{Postgres.DATABASE_URL}}` y añade `INGEST_PAUSED=true`.
3. Publica esta versión y despliega el servidor con esas variables. Espera **SUCCESS**. En los registros debe aparecer `Recepcion de capturas pausada por mantenimiento.`
4. Abre `/healthz` y verifica HTTP 200 con `{"ok":true}`. Entra al monitor y descarga un JSON previo a la migración. Si necesitas una copia completa de la base, conserva también un respaldo PostgreSQL: el JSON de mediciones no reemplaza un `pg_dump`.
5. Revisa el conteo de mediciones y las fechas de las últimas filas. No reanudes la cámara todavía.

### B. Preparar el destino y ejecutar una sola copia

Añade en **Variables del servicio web**:

| Variable | Valor durante la copia |
|---|---|
| `DATABASE_URL` | Mantener `${{Postgres.DATABASE_URL}}`, el origen |
| `INGEST_PAUSED` | `true` |
| `AIVEN_DATABASE_URL` | Service URI privada del PostgreSQL de Aiven |
| `AIVEN_CA_CERT` | Certificado CA completo de Aiven, con sus saltos de línea |

1. En **Settings → Deploy → Pre-deploy Command**, configura `npm run db:copy-to-aiven`. Si el panel ofrece un tiempo límite, usa uno suficiente para tu historial, por ejemplo 600 segundos para este prototipo.
2. Despliega. El paso previo crea las tablas en Aiven y copia cámaras, mediciones y estado. La aplicación seguirá pausada y conectada al origen después de este despliegue.
3. Comprueba en los registros del paso previo el mensaje **`COPIA_AIVEN_OK`** y sus conteos `cameras`, `measurements` y `states`. Si falla, no cambies la conexión: revisa el motivo. El importador se niega a sobrescribir un destino que ya contiene estados o mediciones.
4. Verifica en Aiven que el conteo coincide con el origen y revisa varias filas. No ejecutes de nuevo una copia que ya terminó correctamente; el destino ya estará ocupado.

El origen se lee en una instantánea de solo lectura. La copia de datos del destino es transaccional: si falla antes de confirmar, se revierte. El esquema puede quedar creado y vacío, y la secuencia de IDs puede haberse adelantado ante un fallo final; eso no borra el origen ni crea mediciones parciales. El importador conserva IDs, marcas de tiempo y estado; deja preparada la secuencia para las capturas siguientes.

### C. Cambiar el servidor a Aiven

1. **Borra el contenido del Pre-deploy Command** y guarda. Dejarlo configurado provocaría que una actualización intente copiar de nuevo y se detenga al encontrar datos.
2. Cambia estas variables del servicio web:

| Variable | Valor final |
|---|---|
| `DATABASE_URL` | `${{AIVEN_DATABASE_URL}}` |
| `DATABASE_CA_CERT` | `${{AIVEN_CA_CERT}}` |
| `DATABASE_REQUIRE_TLS` | `true` |
| `INGEST_PAUSED` | `false` |

3. Conserva `AIVEN_DATABASE_URL` y `AIVEN_CA_CERT`: las referencias finales dependen de ellas. Mantén `CAMERA_TOKEN`, `DASHBOARD_PASSWORD` y `SESSION_SECRET` sin cambios.
4. Despliega y espera **SUCCESS**. Verifica `/healthz`, el historial y una descarga JSON. Los conteos y los valores anteriores deben coincidir.
5. Enciende la XIAO y comprueba `HTTP 200`. Actualiza el historial y confirma que se agregan registros nuevos con IDs posteriores.
6. Solo después de comprobar el traspaso puedes detener el servicio `Postgres` original. Conserva el volumen y un respaldo mientras verificas el funcionamiento; no hace falta eliminarlo para completar la migración.

Si el cambio a Aiven falla antes de aceptar capturas nuevas, vuelve a pausar la recepción y restaura la referencia original de `DATABASE_URL`; elimina las variables TLS aplicables solo a Aiven para esa conexión privada. Si ya hay capturas nuevas en Aiven, no cambies al origen sin reconciliar esos datos: las bases habrán empezado a divergir.

Si no existe historial y quieres empezar vacío, omite la copia y configura directamente Aiven como `DATABASE_URL`, con su CA y TLS obligatorio. El servidor creará las tablas al arrancar. Esa opción no traslada registros anteriores.

## 4. Administrar la base y descargar los datos

En Aiven abre tu servicio PostgreSQL y **PG Studio**. Ahí puedes consultar las tablas y ejecutar SQL. Para este proyecto:

```sql
SELECT count(*) AS total FROM public.mediciones;
SELECT * FROM public.mediciones ORDER BY id DESC LIMIT 100;
SELECT pg_size_pretty(pg_database_size(current_database())) AS tamano_base;
```

PG Studio permite exportar resultados de consulta a CSV. Para un archivo JSON completo de mediciones, entra al monitor y pulsa **Descargar todo · JSON**. No necesitas pulsar Cargar más ni mantener abierta una herramienta de administración.

| Descarga | Contenido |
|---|---|
| CSV | Solo las filas cargadas en la tabla del monitor, con porcentajes y fechas UTC |
| JSON | Todas las filas guardadas en `mediciones`, de todas las cámaras, en una instantánea consistente |

El JSON tiene `schema_version`, `exportado_en`, `tabla`, `datos` y `total_registros`. Cada fila conserva los 16 campos de la tabla: ID, cámara, fecha de recepción, arranque, secuencia, conclusión, las cuatro puntuaciones, basura actual y promedio, umbral, cantidad de capturas, confirmaciones y tiempo de análisis. IDs y secuencias van como texto para preservar enteros de 64 bits. Las fechas se expresan en UTC conservando microsegundos. Las puntuaciones originales van de 0 a 1; por ejemplo, `0.45` equivale a 45 %.

La descarga exige una sesión del monitor, igual que el historial. El servidor procesa lotes y permite una exportación simultánea por proceso. Si la conexión falla a mitad de la descarga, se interrumpe el archivo; reintenta la descarga completa. El botón del navegador prepara el archivo en memoria, por lo que para historiales muy grandes conviene usar una herramienta PostgreSQL de escritorio o un respaldo de base de datos.

Se guardan resultados numéricos de cada captura aceptada y solo la última miniatura en `estado_camara`. El JSON no contiene imágenes, pesos del modelo ni un respaldo de todas las tablas. No puede recuperar fotos históricas que nunca se almacenaron.

## 5. Cámara y WiFi

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

## 6. Lógica de detección

1. La cámara obtiene una imagen de **800 × 600** y la envía por HTTPS.
2. El servidor recorta el cuadrado central de **600 × 600**, lo reduce a **224 × 224** y aplica la misma normalización del modelo de Teachable Machine.
3. El modelo entrega las probabilidades de **Sin basura**, **Botellas**, **Papeles y Cartones** y **Bolsas**.
4. El sistema suma Botellas + Papeles y Cartones + Bolsas. Así, un objeto puede alternar entre clases de residuos sin impedir la conclusión conjunta.
5. Promedia hasta cinco capturas recientes. Empieza a evaluar con tres capturas y exige tres confirmaciones consecutivas.
6. Con umbral de 80 %, concluye **Hay basura** si el promedio conjunto es ≥80 %, **Sin basura** si es ≤20 % y **No seguro** en la zona intermedia o durante la confirmación.

La barra principal muestra la confianza estimada en la conclusión confirmada: el promedio de basura para **Hay basura**, o `1 − promedio de basura` para **Sin basura**. Por ejemplo, un promedio de basura del 10 % se presenta como 90 % de confianza de que no hay basura. Para **No seguro**, datos vencidos o un cambio de orientación pendiente, no se muestra un porcentaje de confianza. El panel de clases presenta por separado la suma de basura de la última captura y el promedio de las últimas capturas. Estas puntuaciones del modelo no son una garantía de acierto ni una medida de cantidad de residuos.
7. El nuevo estado y la medición se guardan juntos en PostgreSQL. Si falla la escritura, no se da por guardado un estado parcial.

Con evidencia consistente, la primera conclusión confirmada llega en la quinta captura. Un reinicio de la cámara, un corte largo o un cambio de umbral reinician la ventana de confirmación. Refrescar la web no añade mediciones.

La pausa de captura es de **15 segundos después de terminar cada envío**. El tiempo de red y análisis se suma a esa pausa. No son 15 segundos exactos entre mediciones ni se transmite vídeo continuo. Si un envío falla, la cámara espera al menos 30 segundos antes de otra captura; no almacena una cola de fotos perdidas durante un corte.

Si pasan 90 segundos sin una lectura, el monitor indica **Sin datos recientes**. El historial anterior sigue disponible. Los porcentajes son puntuaciones de clasificación; no expresan volumen, cantidad de objetos ni una medición física de basura.

## 7. Variables y archivos nuevos

| Archivo o variable | Función |
|---|---|
| `lib/raw-export.js` | Lee todas las mediciones por lotes en una instantánea de solo lectura |
| `api/export.js` | Ruta protegida `GET /api/export.json`, descarga y control de interrupciones |
| `lib/database.js` | Pool de cinco conexiones y verificación TLS con CA para Aiven |
| `scripts/copy-to-aiven.js` | Copia única del PostgreSQL actual al destino Aiven |
| `scripts/import-history.js` | Importador general: `SOURCE_DATABASE_URL` → `DATABASE_URL` |
| `SOURCE_DATABASE_CA_CERT` | CA opcional del origen cuando usa el importador general |
| `INGEST_PAUSED` | Detiene temporalmente el análisis y guardado de nuevas capturas |

La base original sigue siendo compatible: añadir JSON no obliga a migrar a Aiven. El certificado del destino no se aplica por accidente al origen: cada conexión usa su propia configuración TLS.

## 8. Desarrollo y pruebas

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

## 9. Librerías y funciones clave

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

## 10. Operación y resolución de problemas

| Síntoma | Qué comprobar |
|---|---|
| `DATABASE_CA_CERT` ausente | Referencia a `AIVEN_CA_CERT` y certificado PEM completo |
| Error de certificado TLS | CA del servicio correcto, nombre del host y fecha del certificado; no usar `rejectUnauthorized:false` |
| HTTP 503 al enviar fotos | `INGEST_PAUSED=false`, salud de Aiven y registros del servidor |
| Fallo del paso previo en nuevos despliegues | Retirar `npm run db:copy-to-aiven` después de la primera copia correcta |
| Copia rechazada por destino ocupado | Confirmar si ya terminó; no vaciar datos para forzar una repetición |
| JSON devuelve HTTP 401 | Volver a entrar al monitor; la sesión dura 12 horas |
| JSON devuelve HTTP 429 | Esperar a que termine la otra exportación |
| JSON interrumpido | Reintentar; no usar un archivo parcial como exportación válida |
| Más de 90 s sin datos | Revisar alimentación, WiFi de 2,4 GHz, servicio Railway y base Aiven |
| `sta is connecting` | Evitar iniciar conexiones WiFi repetidas mientras la conexión anterior sigue en curso |

Para detener el sistema: apaga la XIAO y detén el servicio web. Si ya usa Aiven, detener el Postgres viejo de Railway no detiene la base nueva. Conserva respaldos y revisa los recursos que siguen asignados: un servicio offline no equivale necesariamente a costo total cero, especialmente si conserva almacenamiento o un plan contratado. Un push a la rama conectada puede volver a desplegar el servidor.

Aiven Free tiene límites y condiciones de disponibilidad; comprueba el plan actual en tu consola. Trasladar la base no vuelve gratuito el análisis en Railway. El historial sigue creciendo con cada captura; esta actualización no borra registros ni aplica retención automática.

Documentación oficial:

- Conexión Node.js y CA de Aiven: https://aiven.io/docs/products/postgresql/howto/connect-node
- SSL en node-postgres: https://node-postgres.com/features/ssl
- PG Studio: https://aiven.io/docs/products/postgresql/howto/pg-studio
- Variables de Railway: https://docs.railway.com/guides/variables
- Comandos previos al despliegue: https://docs.railway.com/guides/pre-deploy-command
