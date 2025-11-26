import { getComposeServiceStatus } from "../docker-compose-status.ts";
import { serviceToContainer } from "../services.ts";
import { attachContainerConsole } from "./docker.ts";

export type ServiceConsoleOptions = {
  title?: string;
};

export async function attachServiceConsole(
  service: string,
  options: ServiceConsoleOptions = {},
): Promise<boolean> {
  const container = serviceToContainer(service);
  if (!container) {
    console.error(`Unable to determine container for service ${service}.`);
    return false;
  }

  const status = await getComposeServiceStatus(service);
  if (!status || status.State !== "running") {
    console.log(
      `${service} is not running. Start it before attaching (try \`crtb server start\`).`,
    );
    return false;
  }

  await attachContainerConsole(container, {
    title: options.title ?? service,
  });
  return true;
}
