FROM node:22-bookworm-slim AS build
RUN test "$(uname -m)" = aarch64
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake autoconf libtool libcurl4-openssl-dev python3 unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY lambda/package.json lambda/package-lock.json /runtime/
RUN cd /runtime && npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY lambda/*.ts lambda/tsconfig.json ./lambda/
RUN ./node_modules/.bin/tsc -p lambda/tsconfig.json && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /runtime /runtime
RUN node node_modules/playwright-core/cli.js install-deps firefox \
    && rm -rf /var/lib/apt/lists/*
ENV CAMOUFOX_INSTALL_DIR=/opt/camoufox
# Build-time provisioning only. Keep uBlock and GeoIP identical to the Actions collector.
RUN node node_modules/camoufox-js/dist/__main__.js fetch \
    && test -x /opt/camoufox/camoufox \
    && test -s /opt/camoufox/GeoLite2-City.mmdb \
    && test -s /opt/camoufox/addons/UBO/manifest.json \
    && chmod -R a+rX /opt/camoufox
RUN mkdir -p /var/task && ln -s /app/node_modules /var/task/node_modules
COPY --from=build /app/build /var/task
COPY --from=build /app/package.json /var/task/package.json
COPY config /var/task/config
ENV HOME=/tmp NODE_ENV=production NPM_CONFIG_CACHE=/tmp/npm \
    LAMBDA_TASK_ROOT=/var/task _HANDLER=lambda/handler.handler
WORKDIR /var/task
ENTRYPOINT ["/usr/local/bin/node", "/runtime/node_modules/aws-lambda-ric/index.mjs"]
CMD ["lambda/handler.handler"]
