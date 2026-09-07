FROM node:22-alpine AS web
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/src ./src
COPY server/arena.json /build/server/arena.json
RUN npm run build

FROM golang:1.23-alpine AS backend
WORKDIR /build
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /islandwar .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 game
WORKDIR /app
COPY --from=backend /islandwar /app/islandwar
COPY --from=web /build/frontend/dist /app/dist
ENV STATIC_DIR=/app/dist
USER game
EXPOSE 8080
CMD ["/app/islandwar"]
