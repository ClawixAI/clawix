# shell_net runner — the agent image plus outbound tooling.
# Mirrors infra/docker/agent/Dockerfile except for the added network binaries
# and the git-hang fixes (writable HOME + GIT_TERMINAL_PROMPT=0).
# Build with the shared egress-firewall.sh in context:
#   docker build -f infra/docker/shell-net-runner/Dockerfile infra/docker
FROM python:3.12-slim

# iptables + gosu back the egress-firewall entrypoint (see egress-firewall.sh).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git jq curl wget ca-certificates openssh-client iptables gosu \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace /skills/builtin /skills/custom /app /home/agent \
    && chown -R 1000:1000 /workspace /skills /home/agent

ENV GIT_TERMINAL_PROMPT=0 HOME=/home/agent

# Egress firewall runs as root at boot, programs iptables, then drops to uid
# 1000 via gosu. Do NOT set `USER 1000:1000` — the entrypoint drops privilege
# itself; the runner passes --user 0:0 at start and --user 1000:1000 at exec.
COPY egress-firewall.sh /usr/local/bin/egress-firewall.sh
RUN chmod +x /usr/local/bin/egress-firewall.sh

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/egress-firewall.sh"]
CMD ["sleep", "infinity"]
