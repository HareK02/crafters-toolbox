ARG BASE_IMAGE=eclipse-temurin:21-jdk

FROM ${BASE_IMAGE}

RUN apt-get update -y \
    && apt-get install -y jq curl tree unzip ca-certificates git \
    && apt-get clean \
    && mkdir -p /home/container/

# Install Deno (official install script)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && ln -s /usr/local/bin/deno /usr/bin/deno

COPY ./entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod +x /usr/bin/entrypoint.sh
ENTRYPOINT ["/usr/bin/entrypoint.sh"]

EXPOSE 22

CMD [ "java -Xms128M -Xmx{{MEM_MAX}} -Dterminal.jline=false -Dterminal.ansi=true -jar server.jar nogui" ]
