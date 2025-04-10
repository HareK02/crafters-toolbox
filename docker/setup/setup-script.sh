#!/bin/bash
if [ "$(id -u)" = "0" ]; then
  echo "Welcome to the setup script!"

  USERID=${USER_ID}
  GROUPID=${GROUP_ID}
  echo "Create User = $USERID, Group = $GROUPID"
  groupadd -g $GROUPID setup
  useradd -m -u $USERID -g $GROUPID -s /bin/bash setup
  mkdir /app && chown $USERID:$GROUPID /app

  echo "Installing required packages..."

  LOGFILE=/usr/cache/setup.log
  mkdir -p /usr/cache
  touch $LOGFILE
  chmod 666 $LOGFILE
  chown $USERID:$GROUPID $LOGFILE

  apt-get update >&$LOGFILE
  apt-get install -y tree openssh-server >&$LOGFILE

  echo "done."
  echo "packages installed, switch to user 'setup' and run the setup script..."
  su setup -c "/bin/bash /usr/bin/setup-script.sh"
  exit 0
fi

mkdir -p /app
cd /app

## Gameserver-Setup
echo "Installing gameserver..."

PROJECT=${PROJECT:-paper}
MINECRAFT_VERSION=${MINECRAFT_VERSION:-latest}
BUILD_NUMBER=${BUILD_NUMBER:-latest}

DOWNLOAD_URL=""

get_paper_url() {
  echo "Project: $PROJECT"
  if [ "$MINECRAFT_VERSION" = "latest" ]; then
    echo "Minecraft version: latest"
    MINECRAFT_VERSION=$(curl -s https://api.papermc.io/v2/projects/$PROJECT | jq -r '.versions[-1]')
    echo "    -> $MINECRAFT_VERSION"
  fi
  if [ "$BUILD_NUMBER" = "latest" ]; then
    echo "Build number: latest"
    BUILD_NUMBER=$(curl -s https://api.papermc.io/v2/projects/$PROJECT/versions/$MINECRAFT_VERSION/builds | jq '.builds | map(select(.channel == "default") | .build) | .[-1]')
    echo "    -> $BUILD_NUMBER"
  fi
  JAR_NAME=${PROJECT}-${MINECRAFT_VERSION}-${BUILD_NUMBER}.jar
  DOWNLOAD_URL="https://api.papermc.io/v2/projects/$PROJECT/versions/$MINECRAFT_VERSION/builds/$BUILD_NUMBER/downloads/$JAR_NAME"
  echo "Download URL: $DOWNLOAD_URL"
}

mkdir -p /app/gameserver
if [ "$PROJECT" = "paper" ]; then
  get_paper_url
  echo "Downloading Paper $MINECRAFT_VERSION build $BUILD_NUMBER..."
  curl -o /app/gameserver/server.jar $DOWNLOAD_URL
else
  echo "Unknown project: $PROJECT"
  exit 1
fi

chmod a+x /app/gameserver/server.jar

echo "Server installed."

## SSH-SERVER
echo "Installing SSH server..."
mkdir -p /app/ssh
cd /app/ssh
rm ./sshd_config
cp /usr/data/default/sshd_config.default ./sshd_config
chmod 700 /app/ssh
rm /app/ssh/authorized_keys
touch /app/ssh/authorized_keys
chmod 600 /app/ssh/authorized_keys

cd /app && tree
