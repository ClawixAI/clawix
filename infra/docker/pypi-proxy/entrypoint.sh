#!/bin/bash
# infra/docker/pypi-proxy/entrypoint.sh
# Runs as root initially to fix volume ownership, generate nginx config,
# and start nginx. Then drops to devpi (uid 1000) for devpi-server.
set -euo pipefail

ALLOWLIST_FILE="${ALLOWLIST_FILE:-/etc/clawix/python-allowlist.txt}"
SERVERDIR="${DEVPISERVER_SERVERDIR:-/home/devpi/server}"
NGINX_CONF="/etc/nginx/conf.d/pypi-allowlist.conf"

# ---- Fix ownership of the server data directory ----
# Needed when a named volume is mounted: Docker creates it as root but
# devpi must write to it as uid 1000.
mkdir -p "$SERVERDIR"
chown -R devpi:devpi "$SERVERDIR"

# ---- Generate nginx allowlist config ----
# nginx listens externally on 3141; devpi-server listens on 127.0.0.1:3142.
# Only /root/pypi/+simple/<name>/ URIs are checked against the allowlist;
# all other paths (healthcheck /+api, package files, JSON index) pass through.
#
# PEP 503 normalization note: pip normalizes package names to lowercase with
# hyphens before requesting them, so URIs that reach this proxy are already
# in canonical form. The allowlist file is also required to use normalized
# names (see infra/python-allowlist/README). We therefore do string
# matching on $raw_pkg directly without additional server-side normalization.
mkdir -p "$(dirname "$NGINX_CONF")"

{
  printf '# Auto-generated at container startup. DO NOT edit by hand.\n'
  printf '# Regenerated each time the container starts.\n\n'
  printf 'map $package_name $pkg_allowed {\n'
  printf '    default 0;\n'
  if [ -f "$ALLOWLIST_FILE" ]; then
    while IFS= read -r line; do
      # Skip comment lines and blank lines
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${line// }" ]] && continue
      # Normalize to lowercase; replace underscores and dots with hyphens
      norm=$(echo "$line" | tr '[:upper:]' '[:lower:]' | sed 's/[._]/-/g')
      printf '    "%s" 1;\n' "$norm"
    done < "$ALLOWLIST_FILE"
  fi
  printf '}\n\n'
  printf 'server {\n'
  printf '    listen 3141;\n'
  printf '    server_name _;\n\n'
  printf '    # PyPI simple index: enforce allowlist\n'
  printf '    location ~ ^/root/pypi/\+simple/([^/]+)/? {\n'
  printf '        set $raw_pkg $1;\n'
  printf '        set $package_name $raw_pkg;\n'
  printf '        if ($pkg_allowed = 0) {\n'
  printf '            return 404;\n'
  printf '        }\n'
  printf '        proxy_pass http://127.0.0.1:3142;\n'
  printf '        proxy_set_header Host $host;\n'
  printf '        proxy_set_header X-Real-IP $remote_addr;\n'
  printf '        proxy_read_timeout 60s;\n'
  printf '    }\n\n'
  printf '    # All other devpi paths: healthcheck, package files, JSON API, etc.\n'
  printf '    location / {\n'
  printf '        proxy_pass http://127.0.0.1:3142;\n'
  printf '        proxy_set_header Host $host;\n'
  printf '        proxy_set_header X-Real-IP $remote_addr;\n'
  printf '        proxy_read_timeout 60s;\n'
  printf '    }\n'
  printf '}\n'
} > "$NGINX_CONF"

# Validate the generated config before proceeding
nginx -t

# Remove the default nginx site so it does not conflict on port 80
rm -f /etc/nginx/sites-enabled/default

# Start nginx in daemon mode (background)
nginx

echo "[entrypoint] nginx started, listening on :3141 (devpi will be on 127.0.0.1:3142)"

# ---- Initialize devpi if first run (still running as root, devpi-init runs ok) ----
if [ ! -f "$SERVERDIR/.serverversion" ]; then
  echo "[entrypoint] initializing devpi-server state"
  gosu devpi devpi-init --serverdir "$SERVERDIR"
fi

# ---- Drop to devpi user and exec devpi-server on loopback only ----
echo "[entrypoint] starting devpi-server on 127.0.0.1:3142"
exec gosu devpi devpi-server \
  --serverdir "$SERVERDIR" \
  --host 127.0.0.1 \
  --port 3142 \
  --restrict-modify "" \
  "$@"
