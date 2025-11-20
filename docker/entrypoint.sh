#!/bin/bash

mkdir -p /home/container/gameserver
cd /home/container/gameserver

export PATH=$JAVA_HOME/bin:$PATH

java --version

COMMAND=$@
for i in $(env | grep -oP '^[^=]+' | grep -v '^_'); do
    COMMAND=$(echo "$COMMAND" | sed -e "s|{{${i}}}|${!i}|g")
done

echo "$(pwd): $COMMAND"
${COMMAND}
