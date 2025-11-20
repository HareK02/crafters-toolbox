export type ServiceDetail = {
  alias: string;
  service: string;
  container: string;
};

const SERVICE_DETAILS: ServiceDetail[] = [
  {
    alias: "game",
    service: "game-server",
    container: "crafters-toolbox-game",
  },
  {
    alias: "ssh",
    service: "ssh-server",
    container: "crafters-toolbox-ssh",
  },
  {
    alias: "monitor",
    service: "monitor-server",
    container: "crafters-toolbox-monitor",
  },
];

const ALIAS_LOOKUP = new Map<string, ServiceDetail>();
const SERVICE_LOOKUP = new Map<string, ServiceDetail>();

for (const detail of SERVICE_DETAILS) {
  ALIAS_LOOKUP.set(detail.alias, detail);
  SERVICE_LOOKUP.set(detail.service, detail);
}

export const ALL_SERVICES = SERVICE_DETAILS.map((detail) => detail.service);

export function resolveServiceSelection(tokens: string[]) {
  if (tokens.length === 0) {
    return { services: [...ALL_SERVICES], unknown: [] };
  }

  if (tokens.includes("all")) {
    const unknownAll = tokens.filter((token) => {
      if (token === "all") return false;
      return !ALIAS_LOOKUP.has(token) && !SERVICE_LOOKUP.has(token);
    });
    return { services: [...ALL_SERVICES], unknown: unknownAll };
  }

  const resolved = new Set<string>();
  const unknown: string[] = [];

  for (const token of tokens) {
    const detail = ALIAS_LOOKUP.get(token) || SERVICE_LOOKUP.get(token);
    if (detail) {
      resolved.add(detail.service);
    } else {
      unknown.push(token);
    }
  }

  return { services: [...resolved], unknown };
}

export function serviceToContainer(service: string) {
  return SERVICE_LOOKUP.get(service)?.container;
}

export function describeServiceAliases() {
  return SERVICE_DETAILS.map((detail) => `${detail.alias} -> ${detail.service}`)
    .join(", ");
}
