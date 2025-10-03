#!/bin/bash

# ---------------------------------------------------------------------------
# @file run.sh
# @description Utility wrapper that launches the Procurement Scraper GUI
#   backend with sensible defaults. The script accepts optional arguments for
#   setting the HTTP port and extending the domain allow list used when
#   administrators register new feeds via the UI. By exporting the relevant
#   environment variables before invoking Node.js, the script keeps runtime
#   configuration in one place and avoids manual shell commands.
# @usage ./scripts/run.sh [PORT] [--port PORT] [--allow-domain HOST]
#        ./scripts/run.sh --allow-domains host1,host2
# @structure
#   1. Parse CLI arguments (port plus optional allow-list domains).
#   2. Export environment variables derived from the parsed arguments.
#   3. Launch the Node.js server in the background while printing guidance for
#      retrieving logs.
# ---------------------------------------------------------------------------

set -e

# Track requested port and any allow-list domains supplied by the operator.
PORT_ARG=""
declare -a ALLOWED_DOMAINS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/run.sh [PORT] [options]

Options:
  -p, --port <PORT>           Explicitly set the server port.
      --allow-domain <HOST>   Append a hostname to ALLOWED_SOURCE_DOMAINS.
      --allow-domains <LIST>  Provide a comma-separated list of hostnames.
  -h, --help                  Show this message and exit.

Supplying a bare number without --port is still supported for backwards
compatibility. Hostnames are normalised to lower case and may be specified as
either raw domains or full HTTPS URLs.
EOF
}

# Parse arguments, supporting both legacy positional ports and explicit flags.
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      if [[ -z "$2" ]]; then
        echo "Error: --port requires a numeric argument." >&2
        usage
        exit 1
      fi
      PORT_ARG="$2"
      shift 2
      ;;
    --allow-domain)
      if [[ -z "$2" ]]; then
        echo "Error: --allow-domain requires a hostname." >&2
        usage
        exit 1
      fi
      ALLOWED_DOMAINS+=("$2")
      shift 2
      ;;
    --allow-domains)
      if [[ -z "$2" ]]; then
        echo "Error: --allow-domains requires a comma-separated list." >&2
        usage
        exit 1
      fi
      IFS=',' read -ra MULTI <<<"$2"
      for dom in "${MULTI[@]}"; do
        ALLOWED_DOMAINS+=("$dom")
      done
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$PORT_ARG" && "$1" =~ ^[0-9]+$ ]]; then
        PORT_ARG="$1"
        shift
      else
        echo "Error: Unknown argument '$1'." >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -n "$PORT_ARG" ]]; then
  export PORT="$PORT_ARG"
fi

# Merge supplied domains with any existing ALLOWED_SOURCE_DOMAINS definition.
if [[ ${#ALLOWED_DOMAINS[@]} -gt 0 ]]; then
  IFS=',' read -ra EXISTING <<<"${ALLOWED_SOURCE_DOMAINS:-}"
  COMBINED=()
  for host in "${EXISTING[@]}"; do
    COMBINED+=("$host")
  done
  for host in "${ALLOWED_DOMAINS[@]}"; do
    COMBINED+=("$host")
  done

  declare -A SEEN=()
  DEDUPED=()
  for host in "${COMBINED[@]}"; do
    normalised=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]' | xargs)
    if [[ -z "$normalised" ]]; then
      continue
    fi
    if [[ "$normalised" == *"://"* ]]; then
      normalised=${normalised#*://}
    fi
    normalised=${normalised%%/*}
    normalised=${normalised%%:*}

    if [[ -n "$normalised" && -z "${SEEN[$normalised]}" ]]; then
      SEEN[$normalised]=1
      DEDUPED+=("$normalised")
    fi
  done

  if [[ ${#DEDUPED[@]} -gt 0 ]]; then
    ALLOWED_SOURCE_DOMAINS=$(IFS=','; echo "${DEDUPED[*]}")
    export ALLOWED_SOURCE_DOMAINS
    echo "Allowing additional source domains: $ALLOWED_SOURCE_DOMAINS"
  fi
fi

# Start the Node.js backend in the background. Use nohup so the server keeps
# running even if the launching terminal closes. Suppress stdout/stderr as the
# application already logs to logs/app.log.
nohup node server/index.js >/dev/null 2>&1 &
SERVER_PID=$!

echo "Server started in background on port ${PORT:-3000} (PID: $SERVER_PID)"
echo "View logs with: tail -f logs/app.log"
