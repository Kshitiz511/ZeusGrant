# Production build of the Zeus console: static assets served by nginx, with
# /api/* proxied to the backend services (same-origin — no CORS, no exposed
# service URLs in the client bundle).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
