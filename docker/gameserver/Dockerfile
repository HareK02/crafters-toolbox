ARG BASE_IMAGE=eclipse-temurin:21-jdk

FROM ${BASE_IMAGE}

COPY ./entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod +x /usr/bin/entrypoint.sh
ENTRYPOINT ["/usr/bin/entrypoint.sh"]

RUN apt-get update -y \
  && apt-get install -y lsof curl ca-certificates openssl git tar sqlite3 fontconfig libfreetype6 tzdata iproute2 libstdc++6 \
  && apt-get clean \
  && mkdir -p /home/container/

EXPOSE 22

CMD [ "java -Xms128M -Xmx{{MEM_MAX}} -Dterminal.jline=false -Dterminal.ansi=true -jar server.jar nogui" ]