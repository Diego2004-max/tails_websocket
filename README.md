# tally — preconteo en vivo (BALLOT)

**BALLOT** = *Broadcast · Aggregate · Lock · Log · Observe · Transmit*. Next.js frontend + Node realtime gateway + Redis.

## Qué hay que saber antes de desplegar (Vercel)

Vercel ejecuta funciones serverless: **no puede mantener WebSockets ni conexiones SSE de larga duración**, ni correr 8 instancias de un servidor stateful. Por eso el sistema se parte en dos:

| Pieza | Dónde | Por qué |
|---|---|---|
| Frontend Next.js (`src/`) | **Vercel** | Páginas estáticas/cliente; solo necesita `NEXT_PUBLIC_GATEWAY_URL`. |
| Gateway realtime (`gateway/`) ×8 + balanceador | **Contenedores** (Fly.io, Railway, Render, o `docker compose` local) | Conexiones persistentes, Lua en Redis, fan-out. |
| Redis 7 | Upstash / Redis Cloud / contenedor | Soporta Lua, Streams y Pub/Sub. |

## Arranque local (Docker)

```bash
docker compose up --build          # redis + 8 gateways + nginx en http://localhost:8080
cp .env.example .env.local         # NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
npm install && npm run dev         # frontend en http://localhost:3000
```

Verificaciones rápidas:

```bash
for i in 1 2 3 4 5 6; do curl -s localhost:8080/instance; echo; done   # RT-1/RT-2: instancias distintas
curl -s localhost:8080/metrics/cluster | head -c 600                    # métricas de todas las instancias
```

## Despliegue

1. **Gateway** (ejemplo Fly.io, ver `fly.toml`): `fly launch --no-deploy --dockerfile gateway/Dockerfile`, `fly secrets set REDIS_URL=rediss://... ALLOWED_ORIGIN=https://<app>.vercel.app`, `fly deploy`, `fly scale count 8`.
2. **Frontend**: importar el repo en Vercel; variable `NEXT_PUBLIC_GATEWAY_URL=https://<gateway>.fly.dev`.

> Estas instrucciones y `fly.toml` no se han ejecutado contra una cuenta real: ajusta región, tamaño de VM y límites de conexión a tu proveedor. Con ~50.000 conexiones por instancia necesitas subir `ulimit -n` y dimensionar memoria (mide `kbPerConnection` en `/ops`).

## Pruebas de carga reproducibles (RT-8)

```bash
cd gateway && npm install
npm run loadtest -- --target http://localhost:8080 --sse 20000 --jurors 200 --minutes 2   # jornada comprimida
npm run loadtest -- --target http://localhost:8080 --sse 2000 --slow 20                   # cliente lento (RF-9)
npm run storm -- --target http://localhost:8080 --clients 5000 --mode naive               # genera storm-naive.csv
npm run storm -- --target http://localhost:8080 --clients 5000 --mode jitter              # genera storm-jitter.csv
docker kill $(docker ps -q --filter name=gateway | head -1)                               # muerte real de una instancia
```

Para el cliente lento arranca el gateway con `SSE_PAD_BYTES=200000` para que los búferes se llenen rápido.
Reiniciar los datos: `npm --prefix gateway run reset` y luego `docker compose restart gateway` (re-siembra totales).

## Principios aplicados

- **Monolito modular**: cuatro módulos (`sheets`, `jury`, `broadcast`, `verification`) con API pública en su `index.ts`. El núcleo compartido (`platform/`: Redis, bus, métricas, límite de tasa) no importa módulos. `server.ts` solo compone. El HTTP de petición/respuesta vive en un despachador (`http/router.ts`); WebSocket y SSE no tienen controller porque ya son el adaptador de su módulo.
- **SOLID**: cada módulo tiene una razón de cambio (acta, jurado, público, auditoría). Los hubs dependen de puertos (`SheetIngest`, `SheetStore`, `RateGate`), no de las claves Redis de otro módulo. La inversión de dependencias se cierra en `server.ts`.
- **KISS**: un solo `config.ts`, un solo formato de clave Redis (`keys.ts`), SSE para lo unidireccional, protocolo JSON plano.
- **Idempotencia**: clave por envío + versión monótona por acta, ambas resueltas dentro del mismo script Lua.
- **Tests**: `npm --prefix gateway test` (lógica pura: deltas, ids de stream, backoff).

Decisiones y respuestas a cada RF/RT: ver `docs/REPORT.md`.
