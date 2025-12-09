
import { parseArgs } from "jsr:@std/cli/parse-args";

const args = parseArgs(Deno.args);
const containerName = args._[0] as string;

if (!containerName) {
    console.error("Usage: deno run -A scripts/simple-attach.ts <container-name>");
    Deno.exit(1);
}

// 1. Resolve container ID (to be safe, though name works usually)
// We'll use the CLI just to get the fully qualified ID or verify existence, or just use name in API.
// Using name in API is supported.

console.log(`Connecting to Docker API for ${containerName}...`);

try {
    const conn = await Deno.connect({
        transport: "unix",
        path: "/var/run/docker.sock"
    });

    // 2. Send Attach Request (Hijack)
    // stream=1: Return stream
    // stdin=1: Enable stdin
    // stdout=1: Enable stdout
    // stderr=1: Enable stderr (merged if TTY)
    const request =
        `POST /containers/${containerName}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r
Host: localhost\r
Upgrade: tcp\r
Connection: Upgrade\r
\r
`;

    await conn.write(new TextEncoder().encode(request));

    // 3. Read HTTP Response Headers
    const buffer = new Uint8Array(1);
    let header = "";
    while (true) {
        const n = await conn.read(buffer);
        if (n === null) throw new Error("Connection closed during handshake");
        header += String.fromCharCode(buffer[0]);
        if (header.endsWith("\r\n\r\n")) {
            break;
        }
    }

    if (!header.startsWith("HTTP/1.1 101") && !header.startsWith("HTTP/1.0 101")) {
        console.error("Failed to attach:", header);
        Deno.exit(1);
    }

    console.log("Attached successfully. Streams are now raw.");

    // 4. Decompose and Pipe Streams
    // Since the container likely has TTY, the data is raw.
    // If not TTY, it is multiplexed (StdCopy). 
    // For this script, we assume TTY or just pass-through.
    // To properly "decompose", we expose the reader/writer.

    // Handle Output (Docker -> Stdout)
    const handleOutput = async () => {
        const buffer = new Uint8Array(4096);
        try {
            while (true) {
                const n = await conn.read(buffer);
                if (n === null) break; // Connection closed

                const chunk = buffer.subarray(0, n);
                // "Decomposed": We have the chunk here.
                await Deno.stdout.write(chunk);
            }
        } catch (e) {
            // Connection usually closed here
        }
    };

    // Handle Input (Stdin -> Docker)
    const handleInput = async () => {
        const buffer = new Uint8Array(4096);
        try {
            while (true) {
                const n = await Deno.stdin.read(buffer);
                if (n === null) break; // EOF

                const chunk = buffer.subarray(0, n);
                // "Decomposed": We have the input here.
                await conn.write(chunk);
            }
        } catch (e) {
            // Stdin closed
        }
    };

    // Run both
    await Promise.all([handleOutput(), handleInput()]);

} catch (error) {
    if (error instanceof Deno.errors.NotFound) {
        console.error("Could not connect to /var/run/docker.sock. Is Docker running?");
    } else {
        console.error("Error:", error);
    }
    Deno.exit(1);
}
