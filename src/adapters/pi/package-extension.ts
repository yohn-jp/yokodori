import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createYokodori } from '../../sdk/index.js';
import { createPiExtension } from './index.js';

/** Pi package entrypoint: attach Yokodori's passive observer without changing Pi context. */
export default async function yokodoriPackageExtension(pi: ExtensionAPI): Promise<void> {
  const attachment = await createPiExtension({ runtime: createYokodori(), injection: 'control' });
  attachment.extension(pi);
}
