export async function readComponents(path: string): Promise<string[]> {
  const list: string[] = [];

  try {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory) {
        list.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return list;
}
