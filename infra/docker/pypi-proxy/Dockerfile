FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gosu \
    nginx \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "devpi-server==6.*" \
    "devpi-client==7.*" \
    "devpi-tools>=0.4"

RUN useradd --create-home --shell /bin/bash --uid 1000 devpi

# entrypoint runs as root so it can chown the volume mount, then drops to devpi
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /home/devpi

# Use the canonical env var name (DEVPI_SERVERDIR is deprecated in 6.x)
ENV DEVPISERVER_SERVERDIR=/home/devpi/server

EXPOSE 3141

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsSL "http://localhost:3141/+api" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
