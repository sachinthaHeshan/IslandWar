FROM golang:1.23-alpine AS build
WORKDIR /build
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /islandwar .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 game
WORKDIR /app
COPY --from=build /islandwar /app/islandwar
USER game
EXPOSE 8080
CMD ["/app/islandwar"]
