# Flujo de trabajo

El desarrollo de este proyecto se hace directamente sobre `main`. No se crean ramas de funcionalidad ni se requieren pull requests para los cambios habituales.

## Publicar cambios

Desde la raíz del repositorio, después de revisar los cambios y crear un commit:

```bash
git status
git add <archivos>
git commit -m "Describe the change"
git push origin main
```

Antes de empezar un cambio nuevo, sincroniza `main` con GitHub y asegúrate de que el árbol de trabajo esté limpio:

```bash
git status
git pull --ff-only origin main
```

No uses `--force` para publicar cambios normales.
