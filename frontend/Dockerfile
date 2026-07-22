# ── build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# VITE_BACKEND_URL is baked at build time; left empty the SPA uses relative paths
# (served and proxied by nginx below).
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

# ── serve stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
# Placed as a template so the image's envsubst injects ${PROXY_KEY} / ${BACKEND_HOST}
# from the environment at container start.
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://localhost/ || exit 1
