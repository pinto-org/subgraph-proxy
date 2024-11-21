#!/bin/bash

cd $(dirname "$0")

DOCKER_ENV=$1
PROXY_PORT=$2
if [ -z "$DOCKER_ENV" ] || [ -z "$PROXY_PORT" ]; then
  DOCKER_ENV="dev"
  PROXY_PORT="4001"
fi

export DOCKER_ENV
export PROXY_PORT

# Can optionally provide a specific service to start. Defaults to all
docker compose -p subgraph-proxy-$DOCKER_ENV up -d
