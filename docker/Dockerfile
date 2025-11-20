ARG BASE_IMAGE=eclipse-temurin:21-jdk

FROM ${BASE_IMAGE}

ENV SERVER_DIR=/home/container/server \
    COMPONENTS_DIR=/home/container/components \
    SSH_DATA_DIR=/home/container/components/.ssh \
    MONITOR_SCRIPT=/opt/monitor/monitor.ts

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends \
    jq curl tree unzip ca-certificates git \
    openssh-server libnss-wrapper gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/container /opt/ssh /opt/monitor \
    && ln -sf /usr/lib/$(uname -m)-linux-gnu/libnss_wrapper.so /usr/lib/libnss_wrapper.so || true

# Install Deno (official install script)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && ln -s /usr/local/bin/deno /usr/bin/deno

COPY ./sshd_config /opt/ssh/sshd_config
COPY ./monitor.ts /opt/monitor/monitor.ts
COPY ./entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

EXPOSE 25565 2222

CMD [ "java", "-Xms128M","-Xmx{{MEM_MAX}}", "-Dterminal.jline=false", "-Dterminal.ansi=true", "-jar", "server.jar", "nogui" ]
