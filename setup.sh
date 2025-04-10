#!/bin/bash

# if linux, store UID/GID of the current user to env variables
if [ "$(uname)" == "Linux" ]; then
    USERID=$(id -u)
    GROUPID=$(id -g)
else
    USERID=1000
    GROUPID=1000
fi

mkdir -p ./.app
mkdir -p ./.cache
docker build -f ./docker/setup/Dockerfile -t crafters-workshop-setup .
docker run \
    --env USER_ID=$USERID \
    --env GROUP_ID=$GROUPID \
    --rm \
    -v ./.app:/app \
    -v ./.cache:/usr/cache \
    crafters-workshop-setup
