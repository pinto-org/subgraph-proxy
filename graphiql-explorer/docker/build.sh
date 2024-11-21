#!/bin/bash

cd $(dirname "$0")

DOCKER_ENV=$1
if [ -z "$DOCKER_ENV" ]; then
  DOCKER_ENV="prod"
fi

export DOCKER_ENV

docker build -t graphiql-explorer:$DOCKER_ENV -f ./Dockerfile ../
