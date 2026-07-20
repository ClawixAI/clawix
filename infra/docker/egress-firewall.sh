#!/bin/sh
# Egress firewall for ephemeral containers on clawix-python-net-egress.
# Runs as PID 1 (ENTRYPOINT). Two boot modes, keyed off the effective uid,
# because ONE image (clawix-python-runner:latest) serves both:
#
#   * Booted as root (egress path: --user 0:0 + --cap-add NET_ADMIN, set by the
#     python_run_net / shell_net tools): program the L3/L4 blocks below, then
#     drop to uid 1000 via gosu and exec "$@".
#   * Booted as uid 1000 (the SAME image's other caller — the no-network
#     python_run warm pool: --user 1000:1000, NO NET_ADMIN): apply NO firewall
#     (uid 1000 cannot, and that path never had one) and exec "$@" unchanged.
#     This keeps the no-net path byte-identical at runtime despite the shared
#     image. Without this branch the first iptables call fails under set -eu as
#     uid 1000, the container dies, and python_run breaks.
#
# Fail-closed: on the root path any rule failure aborts (set -eu) so the
# container never runs agent code with an unfiltered network.
#
# NOTE: 127.0.0.0/8 is deliberately NOT dropped. The container netns has its own
# loopback, isolated from the host's; the only lo service is Docker's embedded
# DNS (127.0.0.11), and blocking it would break name resolution for zero gain
# (127.0.0.1:<port> reaches only the agent's own processes). This is a conscious
# deviation from ssrf-protection.ts's isBlockedIpv4, which blocks loopback at the
# app layer where "loopback" means the host's.
set -eu

# 0. No-network path (uid 1000, no caps). The shared image is also the
#    python_run warm-pool base, which boots unprivileged and never had a
#    firewall. Keep it that way; iptables here would only fail (no NET_ADMIN).
if [ "$(id -u)" != 0 ]; then
  [ "$#" -eq 0 ] && set -- sleep infinity
  exec "$@"
fi

# ---- Egress path (root + NET_ADMIN): program the firewall, then drop to 1000. ----

# 1. Loopback (keeps Docker embedded DNS 127.0.0.11:53 reachable).
iptables -A OUTPUT -o lo -j ACCEPT

# 2. Return traffic. (v4 OUTPUT policy stays ACCEPT so this is belt-and-braces
#    on v4 — kept for symmetry with the v6 DROP-policy side; harmless.)
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# 3. Operator allowlist — EGRESS_ALLOWLIST="host[:port],host[:port]".
#    Resolved to IPv4 at boot; ACCEPT inserted before the blocks (step 4).
if [ -n "${EGRESS_ALLOWLIST:-}" ]; then
  OLD_IFS=$IFS; IFS=','
  for entry in $EGRESS_ALLOWLIST; do
    IFS=$OLD_IFS
    host=${entry%%:*}
    port=""
    case "$entry" in *:*) port=${entry##*:} ;; esac
    [ -n "$host" ] || continue
    # Resolve host to IPv4 addresses (getent works for names and literal IPs).
    for ip in $(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u); do
      if [ -n "$port" ]; then
        iptables -A OUTPUT -d "$ip" -p tcp --dport "$port" -j ACCEPT
        iptables -A OUTPUT -d "$ip" -p udp --dport "$port" -j ACCEPT
      else
        iptables -A OUTPUT -d "$ip" -j ACCEPT
      fi
    done
    IFS=','
  done
  IFS=$OLD_IFS
fi

# 4. Block private / metadata / CGNAT / this-host destinations.
for net in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 0.0.0.0/8; do
  iptables -A OUTPUT -d "$net" -j DROP
done

# 5. Public internet — default OUTPUT policy stays ACCEPT.

# 6. IPv6 — only when the kernel has a v6 stack. /proc/net/if_inet6 exists iff
#    IPv6 is enabled; if it's absent there is no v6 egress to leak, so skipping
#    is safe and avoids a spurious fail-closed abort on v4-only hosts where
#    ip6tables can't init its table. If v6 IS present and ip6tables fails,
#    set -eu aborts (correct: never run with an unfiltered v6 path).
if [ -e /proc/net/if_inet6 ]; then
  ip6tables -A OUTPUT -o lo -j ACCEPT
  ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip6tables -P OUTPUT DROP
fi

# 7. Drop root, run the workload as uid 1000. No args → idle.
if [ "$#" -eq 0 ]; then
  set -- sleep infinity
fi
exec gosu 1000:1000 "$@"
