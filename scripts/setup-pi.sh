#!/bin/bash

# setup-pi.sh - prepare the project on a Raspberry Pi.
# This installs Node.js if required, fetches dependencies
# and initialises the database.

set -e

# Ensure apt package lists are up to date and install Node.js
# along with the npm package manager.
sudo apt-get update
sudo apt-get install -y nodejs npm

# Install Node.js dependencies declared in package.json.
npm install

# Initialise the SQLite database so the server can start
# without errors.
npm run init-db
