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
# Placed as a template so the image's envsubst injects ${VIEWER_KEY} / ${BACKEND_HOST}
# from the environment at container start.
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
