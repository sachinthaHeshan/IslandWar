FROM node:22-alpine AS build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/src ./src
COPY server/arena.json /build/server/arena.json
ARG VITE_API_ORIGIN=https://island-war-api.orionlabs.lk
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/frontend/dist /usr/share/nginx/html
EXPOSE 80
