# Informe técnico — tally / BALLOT

> Estado: el código está escrito pero **no se ha ejecutado contra Redis ni desplegado** (el entorno de desarrollo no tenía red ni Redis). Solo se verificó con `tsc` la lógica pura compartida y se ejecutó la geografía, los deltas y el backoff. Las cifras marcadas *(estimado)* son cálculos, no mediciones: hay que reemplazarlas con las de la prueba de carga. El texto del caso que recibí termina en RT-10; **la sección 7 (qué medir) no venía incluida**, así que la tabla de mediciones de abajo es una propuesta.

## 1. Transporte por audiencia (RT-5)

| Audiencia | Transporte | Por qué | Alternativa descartada |
|---|---|---|---|
| Jurados | **WebSocket** | Bidireccional con respuesta explícita por acta (ack / nack / reject) sobre redes malas. | SSE: no hay canal de subida; HTTP POST con polling funciona pero pierde la notificación inmediata de rechazo. |
| Auditores | **WebSocket** | Colaborativo: toman casos y ven a los demás en vivo. | Polling: retraso visible y carga innecesaria. |
| Público | **SSE** | Una sola dirección, HTTP plano, el navegador reanuda con `Last-Event-ID`, más barato por conexión que WS. | WebSocket: añade bidireccionalidad que no se usa; polling a 400.000 clientes cada 2 s = 200.000 req/s. |
| Respaldo | Polling `GET /snapshot` | Disponible si SSE no llega a pasar por un proxy. | — |

Dos transportes coexisten (WS + SSE) más el endpoint de polling.
**Mediciones propuestas** (por transporte): memoria por conexión (`kbPerConnection`), retraso del Event Loop p99/máx, latencia recepción→publicación, mensajes/s y tiempo de reconexión; se leen en `/ops` durante `npm run loadtest`.

## 2. Requerimientos funcionales

**RF-1 Idempotencia.** `idem:{clave}` (TTL 24 h) se consulta **dentro** del script Lua `applySheet`. Un reenvío recibe `DUPLICATE` con la respuesta original; nunca silencio. *Caída entre registrar y confirmar*: el registro y la clave de idempotencia se escriben en la misma operación atómica, así que o ocurrió todo o nada. Si el servidor muere antes de responder, el cliente reintenta con la misma clave y obtiene `DUPLICATE`. Si la clave expiró (>24 h, la ventana de transmisión es 2 h), la versión protege: `version <= guardada` devuelve `STALE` sin sumar.

**RF-2 Correcciones.** Cada acta guarda su versión y si fue contada. Una versión mayor revierte la anterior (delta = nueva − anterior) y aplica la nueva; una menor o igual no cambia nada. El estado final depende solo de la versión máxima por acta, no del orden de llegada.

**RF-3 Atomicidad.** Un único `EVAL`: Redis es monohilo y ejecuta el script sin intercalar otros comandos, así que ningún lector ve mesa/puesto/municipio/departamento a medias. Varios comandos desde la aplicación permitirían que un lector (o una caída) quedara entre uno y otro, y no hay `WATCH` barato para 4 hashes + ranking + stream. Restricciones: el script debe ser corto (bloquea Redis), determinista y declarar sus claves (todas llevan el *hash tag* `{bal}` por si se migra a Cluster).

**RF-4 Fan-out sin bloquear.** `fanOutInBatches` escribe 500 conexiones y cede con `setImmediate`. El retraso del Event Loop (`monitorEventLoopDelay`) se publica por instancia. **Agregación:** cada instancia acumula los deltas por tópico y emite **un mensaje por tópico cada 2 s** (`FLUSH_INTERVAL_MS`). El contador `messages.naive` suma lo que habría enviado un diseño de un mensaje por acta y cliente; `/ops` muestra ambos y la reducción.
*(estimado)* Con 400.000 clientes repartidos 5 % departamento / 60 % municipio / 35 % puesto: un municipio recibe ≈152 actas en 2 h, un puesto ≈3,5, el departamento hasta 3.600 ventanas → ≈109 millones de mensajes frente a 2.560 millones ingenuos (≈23×). Si casi todos miran el departamento la reducción es menor; por eso la ventana es configurable.

**RF-5 Suscripción por tópico.** `TopicRegistry`: `Map<tópico, Set<conexión>>`. Alta y baja O(1) promedio; recorrido O(suscriptores del tópico), independiente del total de la instancia. Además cada instancia se suscribe en Redis solo a los canales con suscriptores locales (conteo de referencias).

**RF-6 Reconexión.** Cada frame SSE lleva `id:` = id del Redis Stream. Al reconectar el cliente manda `lastId`. El servidor responde: (a) **repetición** (`XRANGE (lastId +`), filtrada por tópico y fundida en un solo delta; o (b) **instantánea** si el id es inválido, es más viejo que la entrada más antigua retenida, o hay más de 2.000 entradas por repetir. El cliente ignora cualquier delta con id ≤ el de su estado, así que reaplicar es inocuo.
*Historial:* Redis **Stream** (`XADD … MAXLEN ~ 20000`, `EXPIRE` 12 h). Pub/Sub se usa solo para avisar en vivo. *Memoria (estimado)*: ≈6.580 eventos × ≈350 B ≈ 2,3 MB; el tope de 20.000 supera la jornada completa. Total del dataset (actas, agregados, idempotencia, stream) < 10 MB; verifica con `MEMORY USAGE` / `INFO memory`.

**RF-7 Cola y bloqueo.** Cola = `ZSET` ordenado por diferencia de totales. Bloqueo = `SET lock:{acta} {auditor}:{uuid} NX PX 30000`. *Tensión TTL corto vs. trabajo largo:* el TTL es corto (30 s) para que un auditor desaparecido libere solo; el cliente **renueva cada 10 s mientras hay actividad reciente** (teclado/puntero en los últimos 5 min). Quien trabaja conserva el bloqueo; quien se va a almorzar deja de renovar y el acta vuelve. Al cerrarse el socket también se libera de inmediato. *Liberación segura:* `release` y `renew` son Lua que comparan el token antes de `DEL`/`PEXPIRE`; además `resolve` verifica la propiedad antes de escribir (cerco). Un auditor tardío no puede soltar ni escribir sobre el bloqueo de otro.

**RF-8 Presencia.** Latido cada 8 s: `SET presence:{id} … EX 20` + `ZADD` con score = expiración. Una conexión muerta deja de latir y desaparece sola; el servidor también hace ping/pong WS cada 15 s y termina sockets sin pong.

**RF-9 Contrapresión.** Se mide `res.writableLength` por conexión. Sobre 64 KB: se deja de enviar detalle, se marca la conexión y, cuando baja de 8 KB, recibe **una instantánea**. Sobre 512 KB: se corta; `EventSource` reconecta con `lastId`. Demostración: `loadtest --slow N` + `SSE_PAD_BYTES`; el contador «Lentos» en `/ops`.

**RF-10 Degradación.** Redis caído: los comandos fallan rápido (sin cola offline) → el jurado recibe `nack UNAVAILABLE` con `retryAfterMs` y su acta sigue en cola local; `/healthz` responde 503; los clientes públicos reciben `status: degraded` y la UI lo dice. *Avalancha:* `ReconnectPolicy` (retroceso exponencial con *full jitter*) en todos los clientes; el servidor añade control de admisión (503 + `Retry-After` aleatorio) y, al apagarse, ordena a sus clientes volver en un instante aleatorio. `npm run storm` genera `storm-naive.csv` y `storm-jitter.csv` (intentos/segundo) para graficar.

## 3. Papel de Redis (sección 5)

| Papel | Estructura | Nota |
|---|---|---|
| Backplane | Pub/Sub, canal por tópico (`dept`, `mun:N`, `pst:N`) | Un canal global haría que cada instancia procese todo; por tópico solo recibe lo que sus clientes miran. Costo: 3 `PUBLISH` por acta (6.400 actas: despreciable). |
| Historial | Stream | Ver RF-6. |
| Acumulados | Hash por nivel + `ZSET` de ranking | `HINCRBY` O(1); ranking con `ZREVRANGE` sin recorrer. |
| Operación compuesta | Lua (`EVAL`/`EVALSHA`) | Ver RF-3. |
| Idempotencia | `SET … EX` | Ver RF-1. |
| Bloqueo | `SET NX PX` + Lua | Ver RF-7. |
| Presencia | clave con TTL + `ZSET` | Ver RF-8. |
| Límite de tasa | `INCR` + `EXPIRE NX` por ventana y credencial | Excedido: `nack RATE_LIMITED` con `retryAfterMs` (WS). |

## 4. Sin sesiones pegajosas (RT-2)

**Evita:** desequilibrio por afinidad, pérdida masiva al morir una instancia con clientes «atados», complejidad de balanceo. **Crea:** ninguna instancia puede guardar estado de cliente en memoria; todo lo que importa (cursor `lastId`, cola, locks, presencia) vive en Redis o en el cliente, y cada reconexión puede caer en otra instancia. El diseño lo resuelve con ids de stream en el cliente y estado en Redis.

## 5. Decisiones propias y límites conocidos

- **Actas dudosas no se suman** al acumulado hasta que un auditor las resuelve (nueva versión que cuadra). Así un número publicado no cambia por una acta no verificada. Es una decisión mía; el caso no la fija.
- El acta viaja como en el §3.1: `E14-{puesto}-{mesa}-03` más `mesa`, `puesto` y `municipio` digitados por el jurado. El servidor no los reescribe. El reparto de cuántas mesas hay en cada puesto (el denominador del porcentaje) sí es un censo fijo, porque el caso no publica ese mapa.
- La foto del acta no se almacena: solo su SHA-256 (`photoHash`). No hay autenticación real; `jurorId`/`auditorId` son identificadores declarados. Antes de producción hacen falta ambas cosas.
- Los relojes de las instancias se asumen sincronizados para la latencia de publicación y la presencia.
- Cinco sensores de calidad aún sin hacer: pruebas de integración de los scripts Lua, prueba con 20.000+ conexiones reales, medición de INP en gama baja, validación del `docker compose` con 8 réplicas y despliegue en la nube. Todo eso se hace con los scripts incluidos.
