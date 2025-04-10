ARG SETUP_CONTAINER_IMAGE="debian:bookworm-slim"

FROM ${SETUP_CONTAINER_IMAGE}

RUN apt-get update && apt-get install -y jq curl tree && apt-get clean

COPY ./docker/setup/setup-script.sh /usr/bin/setup-script.sh
RUN chmod a+rwx /usr/bin/setup-script.sh

COPY ./docker/setup/default /usr/data/default


CMD ["/bin/bash", "/usr/bin/setup-script.sh"]