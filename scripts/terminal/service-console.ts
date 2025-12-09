import { getContainerStatus, getContainerName, attachContainer } from "../docker-runner.ts";

export type ServiceConsoleOptions = {
  title?: string;
};

export async function attachServiceConsole(
  service: string,
  options: ServiceConsoleOptions = {},
): Promise<boolean> {
  const containerName = getContainerName(service);

  const status = await getContainerStatus(containerName);
  if (!status.exists || !status.running) {
    console.log(
      `${service} is not running. Start it before attaching (try \`crtb server start\`).`,
    );
    return false;
  }

  await attachContainer(containerName);
  return true;
}
