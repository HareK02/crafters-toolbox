import { ComponentIDString, ComponentIDType } from "./component.ts";

export async function readComponents(
  path: string
): Promise<ComponentIDString[]> {
  const list: ComponentIDString[] = [];

  // Read the directory and filter for folders
  for await (const component_type of Deno.readDir(path)) {
    if (
      !component_type.isDirectory ||
      !RegExp(/^(datapacks|plugins|mods|resourcepacks)$/i).test(
        component_type.name
      )
    )
      continue;

    for await (const component of Deno.readDir(
      `${path}/${component_type.name}`
    )) {
      try {
        if (component.isDirectory) {
          const type = ComponentIDType.toShortString(component_type.name.slice(0, -1));
          if (!type) {
            console.warn(`Unknown component type: ${component_type.name}`);
            continue;
          }
          const ComponentIDString: ComponentIDString =
            type === ComponentIDType.WORLD
              ? "world"
              : `${type}:${component.name}`;
          list.push(ComponentIDString);
        } else {
          console.warn(
            `Skipping non-directory entry ${component.name} in ${component_type.name}`
          );
        }
      } catch (error) {
        console.error(
          `Error reading component ${component.name} in ${component_type.name}:`,
          error
        );
      }
    }
  }
  return list;
}
