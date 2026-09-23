#!/usr/bin/env bash
# Times DNS + TCP + TLS to api.openai.com. No chat completions (no generation tokens).
set -euo pipefail

HOST=api.openai.com
URL=https://api.openai.com/v1/models
ROUNDS=${1:-3}

FMT=$'%{http_code}  namelookup=%{time_namelookup}s  connect=%{time_connect}s  tls=%{time_appconnect}s  ttfb=%{time_starttransfer}s  total=%{time_total}s  ip=%{remote_ip}\n'

probe() {
  local label=$1
  shift
  printf '%s  ' "$label"
  curl -sS -o /dev/null -w "$FMT" --max-time 30 "$@" "$URL" || printf 'FAILED\n'
}

echo "=== DNS ==="
echo -n "A     "
dig +time=3 +tries=1 +short A "$HOST" || true
echo -n "AAAA  "
dig +time=3 +tries=1 +short AAAA "$HOST" || true
echo

for i in $(seq 1 "$ROUNDS"); do
  echo "=== round $i ==="
  probe "auto " --http1.1
  probe "IPv4 " --http1.1 -4
  probe "IPv6 " --http1.1 -6
  echo
done
