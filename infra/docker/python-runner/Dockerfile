FROM python:3.12-slim

# iptables + gosu back the egress-firewall entrypoint: iptables programs the L3
# blocks, gosu drops root -> uid 1000 once the rules are in place.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git jq iptables gosu \
    && rm -rf /var/lib/apt/lists/*

# Configure pip to use the proxy. (At pre-bake time we install from upstream
# via the proxy too; at runtime, agent installs go through the same path.)
# Path is relative to the `infra/docker` build context (not this Dockerfile's
# dir), so it is `python-runner/pip.conf`. Build with:
#   docker build -f infra/docker/python-runner/Dockerfile infra/docker
COPY python-runner/pip.conf /etc/pip.conf

# Pre-bake the common set with pinned majors for reproducibility.
RUN pip install --no-cache-dir --index-url https://pypi.org/simple/ \
    "pandas==2.2.*" \
    "requests==2.32.*" \
    "numpy>=1.26,<3" \
    "httpx==0.27.*" \
    "beautifulsoup4==4.12.*" \
    "python-dateutil==2.9.*"

RUN mkdir -p /workspace && chown -R 1000:1000 /workspace

# Egress firewall runs as root at boot, then drops to uid 1000. Do NOT set
# `USER 1000` — the entrypoint needs root to program iptables on the egress
# path (python_run_net), and no-ops straight to `exec "$@"` (still uid 1000) on
# the no-network warm-pool path (python_run), so this shared image stays correct
# for BOTH callers.
COPY egress-firewall.sh /usr/local/bin/egress-firewall.sh
RUN chmod +x /usr/local/bin/egress-firewall.sh

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/egress-firewall.sh"]
CMD ["sleep", "infinity"]
