FROM rust:1.89.0-bookworm AS builder

ARG commitHash
ENV MEMPOOL_COMMIT_HASH=${commitHash}

WORKDIR /build

RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs=24.19.0-1nodesource1 build-essential python3 pkg-config && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY . .

ENV PATH="/usr/local/cargo/bin:$PATH"

COPY --from=backend . .
COPY --from=rustgbt . ../rust/
ENV FD=/build/rust-gbt
# The pinned runtime pair and the toolchain that builds the native engines;
# a base image that drifts fails here, not later.
RUN node --version | grep -x v24.19.0 && npm --version | grep -x 11.17.0 && cargo --version | grep -F 1.89.0
# Locked install (preinstall builds rust-gbt with this toolchain); the
# vendored first-party tarball in backend/vendor is part of the build context.
RUN npm ci --omit=dev --omit=optional

WORKDIR /build
RUN npm run package

FROM rust:1.89.0-bookworm AS runtime

RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs=24.19.0-1nodesource1 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN node --version | grep -x v24.19.0 && npm --version | grep -x 11.17.0

WORKDIR /backend

RUN chown 1000:1000 ./
COPY --from=builder --chown=1000:1000 /build/package ./package/
COPY --from=builder --chown=1000:1000 /build/GeoIP ./GeoIP/
COPY --from=builder --chown=1000:1000 /build/mempool-config.json /build/start.sh /build/wait-for-it.sh ./

USER 1000

EXPOSE 8999

CMD ["/backend/start.sh"]
