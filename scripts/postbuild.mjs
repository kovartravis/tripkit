// Makes the compiled CLI entry executable so `npx tripkit` / the npm `bin`
// shim can spawn it directly. tsc does not preserve file modes.
import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
if (existsSync(cli)) {
  chmodSync(cli, 0o755);
}
