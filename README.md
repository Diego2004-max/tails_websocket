# tally — preconteo en vivo (BALLOT)

**BALLOT** = *Broadcast · Aggregate · Lock · Log · Observe · Transmit*.

Sistema de preconteo electoral en tiempo real: frontend **Next.js**, gateway **Node** (WebSocket + SSE) y **Redis** como columna vertebral entre instancias. El caso de estudio exige **8 instancias sin sesiones pegajosas**, tres audiencias (jurados, auditores, público) y pruebas de carga reproducibles.

Informe técnico (RF/RT, Redis, transporte): [`docs/REPORT.md`](docs/REPORT.md).

Ramas y push a GitHub (`main` + features): [`docs/BRANCHES.md`](docs/BRANCHES.md).

---

## Modo demo solo Vercel (sin Fly, sin Docker)

Para una **URL pública en el plan Hobby** sin desplegar el gateway: todo el backend va en **Route Handlers** de Next.js (`/api/demo/*`), usando solo lo que Vercel permite bien:

| En el gateway completo | En demo Vercel |
|---|---|
| SSE / WebSocket persistentes | **HTTP**: polling cada 2 s (público y auditoría) y **POST** (jurado) |
| Redis + 8 instancias | **Estado en memoria** del runtime Node (se pierde en cold start) |
| RT-8 con 20k conexiones | Flujo funcional para mostrar UI, actas, cola y acumulados |

**Desplegar:**

1. Importa el repo en Vercel.
2. Variable de entorno: `NEXT_PUBLIC_BALLOT_MODE=vercel`
3. **No** hace falta `NEXT_PUBLIC_GATEWAY_URL`.
4. Deploy → abre `/`, `/jury`, `/audit`, `/ops`.

**Probar en local:**

```bash
cp .env.example .env.local   # deja NEXT_PUBLIC_BALLOT_MODE=vercel
pnpm install && pnpm run dev
```

Verás un aviso amarillo *Modo demo Vercel*. Transmití un acta en `/jury` (usa totales que **no cuadren** si quieres ver la cola en `/audit`).

Limitaciones honestas para la sustentación: no reemplaza RT-1 (8 instancias), RT-4 (fan-out masivo) ni RT-8; para eso sigue el stack Docker + gateway de abajo.

---

## Arquitectura en una imagen

```text
                    ┌─────────────────────────────────────────┐
  Navegador         │  Vercel (opcional)                      │
  localhost:3000    │  Next.js — páginas /jury /audit /ops /  │
       │            └──────────────────┬──────────────────────┘
       │  NEXT_PUBLIC_GATEWAY_URL     │
       ▼                               │
  nginx :8080  (balanceador, sin sticky)│
       │                               │
       ├──► gateway :4000  (×8 instancias stateless)
       │         │ WS /ws/jury, /ws/audit
       │         │ SSE /sse/results
       │         └──► Redis 7 (Lua, Stream, Pub/Sub, locks)
       │
       └──► GET /snapshot, /metrics, /healthz, …
```

Código del gateway: monolito modular bajo `gateway/src/` (`modules/sheets`, `jury`, `broadcast`, `verification` + `platform/` + `http/router.ts`). `gateway/src/server.ts` es la única raíz de composición.

---

## Requisitos

| Herramienta | Versión mínima | Para qué |
|---|---|---|
| **Node.js** | 20 LTS | Frontend y gateway en modo dev |
| **Docker + Compose** | reciente | Redis + 8 gateways + nginx (recomendado para RT-1) |
| **Git** | cualquiera | clonar el repo |

Opcional: cuenta **Fly.io** / **Railway** / **Render** para el gateway en nube; **Upstash** o **Redis Cloud** para Redis gestionado; **Vercel** solo para el frontend.

---

## Variables de entorno

Copia la plantilla del frontend:

```bash
cp .env.example .env.local
```

### Frontend (`.env.local` o Vercel)

| Variable | Ejemplo | Descripción |
|---|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | `http://localhost:8080` | URL pública del balanceador (sin barra final). WebSocket se deriva reemplazando `http` → `ws`. |

### Gateway (Docker, Fly secrets o shell local)

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `4000` | Puerto HTTP/WS del proceso |
| `REDIS_URL` | `redis://localhost:6379` | Redis con soporte Lua, Streams y Pub/Sub |
| `ALLOWED_ORIGIN` | `*` | CORS para SSE y JSON (`https://tu-app.vercel.app` en producción) |
| `INSTANCE_ID` | hostname | Identificador en `/instance` y métricas (Fly: `FLY_MACHINE_ID`) |
| `FLUSH_INTERVAL_MS` | `2000` | Ventana de agregación SSE (RF-4) |
| `FANOUT_BATCH_SIZE` | `500` | Conexiones por tick del Event Loop antes de ceder |
| `SLOW_HIGH_BYTES` / `SLOW_LOW_BYTES` / `SLOW_HARD_BYTES` | 64K / 8K / 512K | Contrapresión RF-9 |
| `SSE_PAD_BYTES` | `0` | Relleno de frames SSE para demos de cliente lento |
| `ADMISSION_RATE` | `2000` | Nuevas conexiones SSE por segundo e instancia (avalancha) |
| `STREAM_MAXLEN` / `REPLAY_LIMIT` | 20000 / 2000 | Historial Redis Stream y tope de replay (RF-6) |
| `IDEMPOTENCY_TTL_SEC` | 86400 | TTL claves de idempotencia (RF-1) |
| `LOCK_TTL_MS` | 30000 | TTL bloqueo auditor (RF-7) |
| `PRESENCE_HEARTBEAT_MS` / `PRESENCE_TTL_SEC` | 8000 / 20 | Presencia RF-8 |
| `RATE_WINDOW_SEC` / `RATE_MAX` | 10 / 30 | Límite de tasa por credencial |

---

## Cómo correr el proyecto

Hay **tres modos**. Elige según lo que vayas a demostrar.

### Modo A — Stack completo (recomendado para sustentación RT-1 / RT-2)

Levanta **Redis**, **8 réplicas del gateway** y **nginx** en el puerto **8080**.

> **Importante:** la clave `deploy.replicas: 8` del `docker-compose.yml` solo aplica en **Docker Swarm**. En Compose normal debes escalar a mano:

```bash
# Desde la raíz del repo
docker compose up --build --scale gateway=8
```

En otra terminal:

```bash
cp .env.example .env.local   # NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
pnpm install                 # o npm install
pnpm run dev                 # http://localhost:3000
```

**Comprobar 8 instancias y balanceo sin sticky:**

```bash
for i in 1 2 3 4 5 6 7 8; do curl -s http://localhost:8080/instance; echo; done
curl -s http://localhost:8080/metrics/cluster | head -c 800
curl -s http://localhost:8080/healthz
```

**Páginas:**

| Ruta | Audiencia | Transporte |
|---|---|---|
| `/` | Público | SSE (`/sse/results`) |
| `/jury` | Jurado | WebSocket + outbox local (RT-6) |
| `/audit` | Auditor | WebSocket colaborativo |
| `/ops` | Operación | Polling métricas (`/metrics/cluster`) |

---

### Modo B — Desarrollo rápido (1 gateway + Redis)

Útil para cambiar código del gateway sin reconstruir 8 contenedores.

**Terminal 1 — Redis:**

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

**Terminal 2 — Gateway:**

```bash
cd gateway
pnpm install    # o npm install
export REDIS_URL=redis://127.0.0.1:6379
export ALLOWED_ORIGIN=http://localhost:3000
pnpm run dev    # escucha en :4000
```

**Terminal 3 — Frontend:**

```bash
cp .env.example .env.local
# Edita .env.local: NEXT_PUBLIC_GATEWAY_URL=http://localhost:4000
pnpm run dev
```

Solo hay **una** instancia; `/instance` siempre devuelve el mismo id. Para RT-1 usa el Modo A.

---

### Modo C — Solo frontend

Si el gateway no está arriba, las páginas cargan pero el stream queda en *connecting* / *degraded* y los WebSockets fallan. Sirve para revisar UI y estilos.

---

## Scripts npm (raíz)

| Script | Acción |
|---|---|
| `pnpm run dev` | Next.js en `:3000` |
| `pnpm run build` / `start` | Build y servidor de producción del frontend |
| `pnpm run stack` | Atajo: `docker compose up --build` (recuerda `--scale gateway=8`) |
| `pnpm run gateway:dev` | Gateway en caliente (`tsx watch`) |
| `pnpm run loadtest -- …` | Delega a `gateway` (RT-8) |
| `pnpm run storm -- …` | Gráfica de reconexión (RF-10) |

En `gateway/`:

| Script | Acción |
|---|---|
| `pnpm run dev` | Gateway con recarga |
| `pnpm run build` / `start` | Bundle esbuild → `dist/server.js` |
| `pnpm test` | Tests unitarios (delta, stream ids, jitter) |
| `pnpm run reset` | Borra claves `{bal}:*` en Redis (datos de jornada) |

---

## Pruebas de carga y demostraciones (RT-8, RF-9, RF-10)

Con el stack en **8080**:

```bash
cd gateway && pnpm install

# Perfil de jornada comprimido (~20k SSE + jurados)
pnpm run loadtest -- --target http://localhost:8080 --sse 20000 --jurors 200 --minutes 2

# Clientes SSE lentos (contrapresión)
pnpm run loadtest -- --target http://localhost:8080 --sse 2000 --slow 20
# Opcional: en docker-compose, gateway con SSE_PAD_BYTES=200000

# Avalancha de reconexión (genera CSV ignorados por git)
pnpm run storm -- --target http://localhost:8080 --clients 5000 --mode naive
pnpm run storm -- --target http://localhost:8080 --clients 5000 --mode jitter

# Muerte de una instancia (Modo A)
docker ps --filter name=gateway -q | head -1 | xargs docker kill
```

Abre **`/ops`** durante la prueba: conexiones, msg/s, event loop, actas/min, latencia publicación.

**Reiniciar datos:**

```bash
pnpm --prefix gateway run reset
docker compose restart gateway   # o vuelve a levantar el stack
```

---

## Despliegue en nube

Vercel **no** sustituye al gateway: en Hobby las funciones cortan conexiones largas (~**300 s** máximo) y no puedes correr 8 procesos stateful con 50k conexiones cada uno. Patrón habitual:

| Pieza | Dónde |
|---|---|
| Frontend `src/` | **Vercel** — solo `NEXT_PUBLIC_GATEWAY_URL` |
| Gateway ×8 + LB | **Fly.io** (`fly.toml`), Railway, Render, o VM + Docker |
| Redis 7 | Upstash, Redis Cloud, o contenedor gestionado |

**Fly (resumen):**

```bash
fly launch --no-deploy --dockerfile gateway/Dockerfile
fly secrets set REDIS_URL=rediss://... ALLOWED_ORIGIN=https://<app>.vercel.app
fly deploy
fly scale count 8
```

**Vercel:** importar repo, variable `NEXT_PUBLIC_GATEWAY_URL=https://<tu-gateway>`.

Demo académica viable: **frontend en Vercel free + gateway en Fly/Railway free tier limitado + Upstash Redis**. No alcanzará 400k clientes reales; sí demuestra arquitectura, RT-1 con 8 máquinas pequeñas y RT-8 con loadtest desde tu máquina contra la URL pública.

---

## Rendimiento: qué ya está optimizado

- **Fan-out por lotes** (`fanOutInBatches` + `FANOUT_BATCH_SIZE`) para no bloquear el Event Loop (RF-4).
- **Agregación por ventana** (`FLUSH_INTERVAL_MS`): un delta por tópico cada 2 s, no un mensaje por acta × cliente.
- **Suscripción por tópico** (`TopicRegistry` + canales Redis por tópico): costo proporcional a suscriptores del municipio/puesto, no al total de la instancia.
- **Escritura atómica** en un solo script Lua (`applySheet`): idempotencia, acumulados jerárquicos e historial sin estados intermedios visibles.
- **Contrapresión SSE** por `writableLength` con degradación a snapshot y corte duro (RF-9).
- **Reconexión con jitter** en cliente (`ReconnectPolicy`) y admisión 503 + `Retry-After` en servidor (RF-10).

---

## Rendimiento: puntos de mejora (priorizados)

Estos no invalidan el diseño; son el siguiente escalón si miden cuello de botella en `/ops` o en loadtest.

### Gateway / Node

1. **Serialización JSON repetida** — Cada frame SSE pasa por `JSON.stringify` en `frame()`. En flush ya se construye **un** string por tópico por ventana (bien). Mejora: cachear plantillas de heartbeat (`: ping\n\n`) y reutilizar buffers para snapshots muy frecuentes en clientes lentos.
2. **Flush secuencial por tópico** — El `for (const [topic, message] of batch)` espera a terminar un tópico antes del siguiente. Con muchos municipios activos a la vez, **paralelizar tópicos** con `Promise.all` (cuidando orden de métricas) puede bajar la latencia p99 de publicación.
3. **`/metrics/cluster`** — Hace `SCAN` + `MGET` en cada petición desde `/ops`. Añadir **cache de 1–2 s** en memoria evita presionar Redis cuando hay varios operadores mirando el tablero.
4. **AuditHub** — Cada cambio de cola dispara `readQueue()` + `presence.list()` y un `JSON.stringify` grande para **todos** los auditores. Con 120 conexiones está bien; optimización: **diff incremental** (solo `take`/`release`) o aumentar el debounce cuando la cola no cambió.
5. **`QueueService.list`** — Parsea `votes` con `JSON.parse` por acta en cada broadcast. Cachear filas de cola en Redis como blob pre-serializado o campos planos reduciría CPU en picos de verificación.
6. **Rate limiter** — Dos round-trips (`INCR` + `EXPIRE NX`). Un **script Lua de ventana fija** por credencial unifica en un solo `EVAL`.
7. **Health degradado** — `setInterval(..., 2000)` consulta estado Redis aunque no haya clientes públicos. Escuchar eventos `error`/`ready` de ioredis bajaría trabajo idle.
8. **Heartbeats SSE** — Cada 20 s recorre todos los tópicos registrados. Omitir tópicos sin suscriptores activos (Set vacío) ya ocurre; evitar crear Sets huérfanos al desuscribir acelera iteraciones con muchas reconexiones.

### Redis

9. **Tres `PUBLISH` por acta** (dept, mun, pst) — Correcto para RF-5; costo bajo (~6.400 actas). En Cluster, el hash tag `{bal}` ya agrupa claves del script.
10. **Stream `MAXLEN ~`** — Aproximado ahorra CPU; si en replay ves muchos `snapshot` por *gap*, sube `STREAM_MAXLEN` o baja retención con métricas de memoria (`INFO memory`).

### Frontend (INP / RT-9)

11. **Primera carga en `next dev`** — Compilación bajo demanda (~15 s la primera vez en `/`) es normal en dev. Para medir INP real usa **`pnpm run build && pnpm start`** o la build de Vercel.
12. **`applyDelta` en cada evento** — Reordena ranking de 3 candidatos; costo negligible. Si el delta trae muchas claves, considerar **actualizar solo buckets tocados** sin clonar todo `totals`.
13. **Cambio de tópico en `/`** — Reinicia el stream completo; esperado. Prefetch del snapshot vía `GET /snapshot?topic=` antes de abrir SSE reduciría tiempo hasta primer pixel útil.

### Infra

14. **`ulimit -n`** — Con decenas de miles de SSE por instancia, el compose ya sube `nofile` en el servicio gateway; en bare metal hay que hacer lo mismo.
15. **nginx** — `proxy_buffering off` está bien para SSE. Para WS, vigilar timeouts alineados con heartbeats (15 s audit ping, 20 s SSE comment).

---

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Público en *connecting* forever | Gateway caído o URL mal en `.env.local` | `curl $NEXT_PUBLIC_GATEWAY_URL/healthz` |
| CORS en SSE | `ALLOWED_ORIGIN` no incluye el origen del frontend | En gateway: `ALLOWED_ORIGIN=http://localhost:3000` |
| Siempre la misma instancia en Modo A | Olvidaste `--scale gateway=8` | `docker compose ps` debe listar 8 contenedores gateway |
| Jurado en *queued* sin fin | Redis caído | `/healthz` → 503; jurado recibe `nack UNAVAILABLE` y reintenta |
| `pnpm` instala en raíz pero gateway falla | Dependencias solo en `gateway/` | `cd gateway && pnpm install` |
| Actas no suman | Acta *dudosa* (no cuadra contabilidad) | Va a cola en `/audit`; no entra al acumulado hasta resolver |
| Datos viejos tras pruebas | Redis persistió actas | `pnpm --prefix gateway run reset` |
| `GET /sw.js 404` en dev | Service worker viejo de otro proyecto en `:3000` | `public/sw.js` limpia el registro; o DevTools → Application → Unregister |
| `Cannot find module './67.js'` / Fast Refresh reload | Caché `.next` corrupta (p. ej. `build` con `dev` abierto) | Para el servidor y `pnpm run dev:clean` |

---

## Estructura del repositorio

```text
ballot/
├── src/                 # Next.js (app router)
├── shared/              # domain, protocol, reconnect (frontend + gateway)
├── gateway/src/
│   ├── server.ts        # composición
│   ├── http/router.ts   # GET JSON + delegación SSE
│   ├── modules/         # sheets | jury | broadcast | verification
│   └── platform/        # redis, bus, metrics, config, rate-limit
├── nginx/               # balanceador local
├── docker-compose.yml
├── fly.toml
└── docs/REPORT.md
```

---

## Principios de diseño

- **Monolito modular** con fronteras por audiencia; WebSocket/SSE son adaptadores, no controllers HTTP extra.
- **SOLID**: puertos (`SheetIngest`, `SheetStore`, `RateGate`, `RuntimeMetrics`); detalles Redis encapsulados en `platform/` y `SheetService`.
- **Tests**: `pnpm --prefix gateway test`.

---

## Licencia / uso

Proyecto académico (Programación Orientada a la Web). El plan Hobby de Vercel restringe uso comercial; para demo del taller, frontend en Vercel + backend en contenedor suele ser suficiente.
