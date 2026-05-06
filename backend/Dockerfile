ARG GO_VERSION=1.26

FROM golang:${GO_VERSION}-bookworm AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY pkg ./pkg

ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/food-link ./cmd/server

FROM scratch

WORKDIR /app

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /out/food-link /app/food-link
COPY docs/backend-api-prd/ROUTE_MAP.md /app/docs/backend-api-prd/ROUTE_MAP.md

ENV APP_ENV=production \
    PORT=3010 \
    GIN_MODE=release \
    TZ=Asia/Shanghai

EXPOSE 3010

ENTRYPOINT ["/app/food-link"]
