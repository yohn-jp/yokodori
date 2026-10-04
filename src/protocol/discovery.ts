import { homedir } from 'node:os';
import { join } from 'node:path';
export const endpointFile = () => join(process.env.YOKODORI_RUNTIME_DIR ?? join(homedir(), '.cache', 'yokodori'), 'endpoint.json');
