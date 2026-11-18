# Operator-only build recipe. The application never builds or pulls this image.
# Supply NODE_IMAGE as an approved Node image pinned by sha256 digest.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/sebby
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && chmod -R a+rX /opt/sebby
