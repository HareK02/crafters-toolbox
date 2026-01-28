export async function dockerTest() {
  const dockerCheck = new Deno.Command("docker", {
    args: ["--version"],
  });
  const dockerCheckResult = dockerCheck.spawn();
  const res = await dockerCheckResult.status;
  if (!res.success) {
    console.error("Docker is not installed. Please install Docker.");
  }
  return res.success;
}
