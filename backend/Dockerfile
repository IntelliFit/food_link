ARG GO_BUILDER_IMAGE=docker.io/library/golang:1.26.1-bookworm

FROM --platform=$BUILDPLATFORM ${GO_BUILDER_IMAGE} AS builder

WORKDIR /src

ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY pkg ./pkg

ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ENV CGO_ENABLED=0
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/food-link ./cmd/server

# Keep the runtime base identical to the deployed image for repeatable builds.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

WORKDIR /app

RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates ffmpeg tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/food-link /app/food-link
COPY docs/backend-api-prd/ROUTE_MAP.md /app/docs/backend-api-prd/ROUTE_MAP.md
COPY static /app/static
COPY data /app/data

ENV APP_ENV=production \
    PORT=3010 \
    GIN_MODE=release \
    TZ=Asia/Shanghai

EXPOSE 3010

ENTRYPOINT ["/app/food-link"]
