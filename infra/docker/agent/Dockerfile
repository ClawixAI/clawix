# Clawix Agent Container — runs agent code in isolation
# Build: docker build -t clawix-agent:latest -f infra/docker/agent/Dockerfile .

FROM python:3.12-slim

# Curated system tools (curl excluded — no network access; add when proxy is implemented)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git jq \
    && rm -rf /var/lib/apt/lists/*

# Create workspace and skill directories (skills are separate from /workspace
# to avoid polluting the user's workspace bind mount on the host)
RUN mkdir -p /workspace /skills/builtin /skills/custom /app \
    && chown -R 1000:1000 /workspace /skills

# Non-root user (uid 1000 — matches --user 1000:1000 from container runner)
USER 1000:1000
WORKDIR /workspace

# Container stays alive for docker exec; tools execute commands inside it
CMD ["sleep", "infinity"]
