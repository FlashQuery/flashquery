import { createServer } from 'node:net';

/**
 * Check if a port is available for binding on the specified address.
 *
 * @param port - The port number to check (should be validated in 1-65535 range before calling)
 * @param address - The bind address to check (typically '127.0.0.1')
 * @returns Promise that resolves if the port is available, rejects with error message if not
 *
 * Implementation uses Node.js net.createServer() to attempt a quick bind/close sequence.
 * This is the canonical pattern for checking port availability without external dependencies.
 *
 * Per D-02a (Phase 46): Uses net.createServer() for port availability check
 * Per D-02b (Phase 46): Called after logger init, before vault/Supabase init
 * Per D-02c (Phase 46): Skipped for stdio transport (has no port to check)
 */
export async function checkPortAvailable(port: number, address: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      // Per D-03a: EADDRINUSE error gets actionable message
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} already in use. Stop the process using it or change mcp.port in your config.`
          )
        );
      } else {
        // Per D-03d: Other errors logged with context
        reject(new Error(`Port check failed: ${err.message}`));
      }
    });

    server.once('listening', () => {
      // Port is available — close the test server and resolve
      server.close();
      resolve();
    });

    // Attempt to bind to the specified port and address
    server.listen(port, address);
  });
}
