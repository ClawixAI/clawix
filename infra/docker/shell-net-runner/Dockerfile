# shell_net runner — shell-only outbound tooling.
#
# ⚠ Deliberately NOT based on the python image. shell_net is a separate tool
# from python_run / python_run_net with its own policy caps, package allowlist,
# pip proxy, and audit path (see shell-net.ts + python-run-net.ts). If this
# image shipped python/pip, an agent could call `python …` or `pip install …`
# through shell_net and bypass all of that — package allowlist, mutex,
# concurrency limiter, proxy, audit. Keeping the image python-free closes the
# leak at the boundary: there is no interpreter to call. If a shell_net task
# ever genuinely needs python, that's what python_run_net is for.
#
# Build with the shared egress-firewall.sh in context:
#   docker build -f infra/docker/shell-net-runner/Dockerfile infra/docker
FROM debian:bookworm-slim

# iptables + gosu back the egress-firewall entrypoint (see egress-firewall.sh).
# curl/wget/git/jq/ssh are the intended shell_net surface. No python, no pip.
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
