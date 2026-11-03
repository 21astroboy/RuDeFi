FROM ubuntu:22.04 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates libcurl4-openssl-dev libboost-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY CMakeLists.txt ./
COPY backend/ ./backend/
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DRUDEFI_COPY_FRONTEND=OFF \
    && cmake --build build --parallel 2

FROM ubuntu:22.04
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* && useradd -m -u 1000 app
WORKDIR /app
COPY --from=builder /app/build/cryptoapp ./cryptoapp
COPY --from=builder /app/build/config ./config
COPY frontend/ ./frontend/
USER app
ENV PORT=8787
EXPOSE 8787
CMD ["/bin/sh", "-c", "./cryptoapp serve --bind 0.0.0.0 --port ${PORT}"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/healthz" || exit 1
