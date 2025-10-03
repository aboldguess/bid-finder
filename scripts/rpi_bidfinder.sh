#!/bin/bash

# ---------------------------------------------------------------------------
# @file rpi_bidfinder.sh
# @description Automated setup routine tailored for Raspberry Pi deployments.
#   The script installs Node.js, fetches dependencies, initialises the SQLite
#   database and optionally launches the Procurement Scraper GUI. Operators can
#   skip development dependencies, choose a listening port and extend the
#   allowed domain list so new feeds (such as DSTL) can be registered without
#   manual environment configuration.
# @usage ./scripts/rpi_bidfinder.sh [-p|--production] [PORT]
#        ./scripts/rpi_bidfinder.sh --allow-domain contracts.mod.uk 4000
# @structure
#   1. Parse command-line arguments for production mode, port and domain
#      options.
#   2. Install prerequisites and project dependencies.
#   3. Initialise the database and optionally start the server using run.sh.
# ---------------------------------------------------------------------------

set -e

# Parse command line options for production mode, port and allow-list domains.
PROD=0
PORT=""
declare -a RUN_ARGS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/rpi_bidfinder.sh [options] [PORT]

Options:
  -p, --production           Install only production dependencies.
      --allow-domain <HOST>  Forward hostname to run.sh for allow-listing.
      --allow-domains <LIST> Forward comma-separated hostnames to run.sh.
  -h, --help                 Display this help message and exit.

Providing a bare number continues to set the server port for backwards
compatibility. Any allow-domain options are passed to run.sh so the Node.js
process receives the expanded ALLOWED_SOURCE_DOMAINS variable.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--production)
      PROD=1 # toggle to install only production dependencies
      shift
      ;;
    --allow-domain)
      if [[ -z "$2" ]]; then
        echo "Error: --allow-domain requires a hostname." >&2
        usage
        exit 1
      fi
      RUN_ARGS+=("--allow-domain" "$2")
      shift 2
      ;;
    --allow-domains)
      if [[ -z "$2" ]]; then
        echo "Error: --allow-domains requires a comma-separated list." >&2
        usage
        exit 1
      fi
      RUN_ARGS+=("--allow-domains" "$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$PORT" && "$1" =~ ^[0-9]+$ ]]; then
        PORT="$1" # treat any other argument as the desired port
        shift
      else
        echo "Error: Unknown argument '$1'." >&2
        usage
        exit 1
      fi
      ;;
  esac
done

# Ensure system packages are up to date and then install Node.js.
# The Node.js package from NodeSource already includes npm; installing the
# separate `npm` package causes conflicts with this bundled version, so we
# avoid installing it explicitly.
sudo apt-get update

# Remove any previously installed standalone npm package to avoid conflicts
# with the bundled npm from NodeSource's Node.js package. Suppress errors if
# npm is not present so the script can proceed.
sudo apt-get purge -y npm || true

sudo apt-get install -y nodejs

# Install Node.js dependencies; limit to production packages when requested
if [[ $PROD -eq 1 ]]; then
  npm install --production
else
  npm install
fi

# Initialise the SQLite database so the server can start without errors
npm run init-db # create the SQLite database

# Launch the application when a port number is supplied. The run.sh helper
# exports PORT before starting the Node.js server. The server is started in the
# background so this script exits immediately.
if [[ -n "$PORT" ]]; then
  RUN_ARGS+=("--port" "$PORT")
  ./scripts/run.sh "${RUN_ARGS[@]}"
fi

echo "Setup complete."

