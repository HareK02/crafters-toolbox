#!/bin/bash

if [ "$(id -u)" = "0" ]; then
    USERID=${USER_ID}
    GROUPID=${GROUP_ID}

    USERNAME=$(getent passwd $USERID | cut -d: -f1)

    if [ -z "$USERNAME" ]; then
        echo "Create User = $USERID, Group = $GROUPID"
        useradd -m -u $USERID -g $GROUPID -s /bin/bash gameserver
        USERNAME=gameserver
    fi
    groupadd -g $GROUPID gameserver
    chown $USERID:$GROUPID /home/container

    su ${USERNAME} -c "/bin/bash /usr/bin/entrypoint.sh $@"
    exit 0
fi

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
