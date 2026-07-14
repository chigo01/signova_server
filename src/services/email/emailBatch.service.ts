const EMAIL_BATCH_SIZE = 5;
const EMAIL_BATCH_INTERVAL_MS = 1100;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runEmailBatch(
  jobs: Array<() => Promise<void>>,
): Promise<void> {
  for (let index = 0; index < jobs.length; index += EMAIL_BATCH_SIZE) {
    await Promise.all(jobs.slice(index, index + EMAIL_BATCH_SIZE).map((job) => job()));
    if (index + EMAIL_BATCH_SIZE < jobs.length) {
      await sleep(EMAIL_BATCH_INTERVAL_MS);
    }
  }
}
