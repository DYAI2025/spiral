# Spiral / Helix Projects

Railway-ready static deployment for the **Helix Projects — Spatial Gallery** experience.

## Project layout

- `public/index.html` is the deployed single-page gallery.
- `server.js` is a minimal Node.js static file server that respects Railway's `PORT` environment variable.
- `railway.json` configures Railway/Nixpacks, the production start command, and a `/healthz` health check.
- `uploads/` keeps the received audit artifacts and optimized source export for reference.

## Local development

```bash
npm start
```

Open <http://localhost:3000>.

## Validation

```bash
npm run check
npm start
curl -I http://localhost:3000/healthz
```

## Railway deployment

1. Create a Railway project from this repository.
2. Railway will use Nixpacks to install Node.js 20+ and run `npm start`.
3. The app listens on `0.0.0.0:$PORT` and exposes `/healthz` for health checks.

No build step is required because the gallery is served as static HTML.
