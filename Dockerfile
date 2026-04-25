# Multi-stage Dockerfile for the public DeFi dashboard.
# Stage 1 builds the C++ binary; stage 2 ships only the runtime.
#
# Tested on Render free tier (Docker web service) and Fly.io free tier.

# ---------- Build stage ----------
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        ca-certificates \
        libcurl4-openssl-dev \
        libboost-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY CMakeLists.txt ./
COPY include ./include
COPY src     ./src
COPY apps    ./apps
COPY config  ./config
COPY ui      ./ui

RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" --target cryptoapp

# ---------- Runtime stage ----------
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        libcurl4 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 app

WORKDIR /app
# The post-build hook in CMakeLists copies config/ + ui/ next to the binary.
COPY --from=builder /app/build/cryptoapp        ./cryptoapp
COPY --from=builder /app/build/config           ./config
COPY --from=builder /app/build/ui               ./ui

USER app

# Free-tier hosts assign $PORT — bind to it. Defaults to 8787 locally.
ENV PORT=8787
EXPOSE 8787

# Bind 0.0.0.0 so the host can route external traffic in.
CMD ["/bin/sh", "-c", "./cryptoapp serve --bind 0.0.0.0 --port ${PORT}"]

# Health check used by Render / Fly.io probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/healthz" || exit 1
