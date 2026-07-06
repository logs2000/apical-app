// Cloud GPU job backend — interface stub. Deferred per scope: server +
// desktop backends ship; the cloud path is a placeholder to fill in with a
// provider (RunPod/Modal) later. The provider API key would resolve from the
// vault via resolveCredentialForAgent, exactly like other integrations.

import { db } from '@/lib/db'
import type { JobBackend } from './types'

export const cloudJobBackend: JobBackend = {
  id: 'cloud',
  async dispatch(jobId) {
    await db.job.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: 'Cloud GPU backend is not configured. Use backend "server" or "desktop".',
        claimedBy: null,
        leaseUntil: null,
        finishedAt: new Date(),
      },
    })
  },
  async cancel() {
    /* nothing running */
  },
}
