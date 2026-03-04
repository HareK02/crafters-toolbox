FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends \
        fish \
        git \
        openssh-server \
        gawk \
        gzip \
        unzip \
        ca-certificates \
        libnss-wrapper \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -M -d /var/empty/sshd -s /bin/false sshd || true \
    && mkdir -p /home/container/server \
               /home/container/components \
               /home/container/.ssh/host_keys \
               /opt/ssh \
    && chmod 1777 /tmp

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY sshd_config   /opt/ssh/sshd_config

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && ln -s entrypoint.sh /usr/local/bin/start-game \
    && ln -s entrypoint.sh /usr/local/bin/start-ssh

ENV LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    HOME=/home/container \
    LOGIN_SHELL=/usr/bin/fish \
    DEFAULT_SHELL=/usr/bin/fish

EXPOSE 25565 2222
WORKDIR /home/container/server
CMD ["/usr/local/bin/entrypoint.sh"]
