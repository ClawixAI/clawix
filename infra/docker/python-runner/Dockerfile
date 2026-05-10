FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git jq \
    && rm -rf /var/lib/apt/lists/*

# Configure pip to use the proxy. (At pre-bake time we install from upstream
# via the proxy too; at runtime, agent installs go through the same path.)
COPY pip.conf /etc/pip.conf

# Pre-bake the common set with pinned majors for reproducibility.
RUN pip install --no-cache-dir --index-url https://pypi.org/simple/ \
    "pandas==2.2.*" \
    "requests==2.32.*" \
    "numpy>=1.26,<3" \
    "httpx==0.27.*" \
    "beautifulsoup4==4.12.*" \
    "python-dateutil==2.9.*"

RUN mkdir -p /workspace && chown -R 1000:1000 /workspace

USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
