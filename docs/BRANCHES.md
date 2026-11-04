# Ramas del repositorio

Remoto: [Diego2004-max/tails_websocket](https://github.com/Diego2004-max/tails_websocket.git). La rama por defecto en GitHub es **`main`**, no `master`.

## Mapa (orden de integración sugerido)

```text
f17367f  (inicial)
    └── feat/monolito-modular   → gateway modular (a6140c2)
            └── chore/gitignore → .gitignore (bf3f608)
                    └── feat/demo-vercel → API demo Vercel (71bc440)
                            └── docs/readme-stack → README + compose (cdd4c0d)
                                    └── main → HEAD (dev:clean, sw.js, …)
```

| Rama | Commit | Contenido |
|---|---|---|
| `main` | HEAD | Línea actual completa (despliegue / demo Vercel / docs) |
| `feat/monolito-modular` | `a6140c2` | Monolito modular en `gateway/` |
| `chore/gitignore` | `bf3f608` | `.gitignore` ampliado |
| `feat/demo-vercel` | `71bc440` | Modo demo solo Vercel (`/api/demo`) |
| `docs/readme-stack` | `cdd4c0d` | README detallado, `docker-compose`, fix PublicHub |

## Subir a GitHub (primera vez)

Desde la raíz del repo, con sesión GitHub activa (`gh auth login` o SSH):

```bash
git remote -v   # origin → tails_websocket

# Rama principal (reemplaza el README vacío del remoto)
git push -u origin main

# Ramas de revisión (opcional, para PRs encadenados)
git push -u origin feat/monolito-modular
git push -u origin chore/gitignore
git push -u origin feat/demo-vercel
git push -u origin docs/readme-stack
```

Si GitHub rechaza `main` por historial distinto (solo el commit “first commit” remoto):

```bash
git push -u origin main --force-with-lease
```

## PRs encadenados (opcional)

1. `feat/monolito-modular` → `main` del remoto en `f17367f` (o base `init` si la creas ahí).
2. Cada rama siguiente apunta al tip de la anterior; en GitHub cambia la **base** del PR a la rama previa.

Para desarrollo día a día: trabaja en `main` o abre ramas `feat/*` desde `main` y mergea con PR.
