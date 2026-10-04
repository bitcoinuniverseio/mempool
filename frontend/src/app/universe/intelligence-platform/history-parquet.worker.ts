/// <reference lib="webworker" />
import { readHistoryParquet } from './history-parquet';

addEventListener('message', async ({ data }) => {
  try { postMessage({ result: await readHistoryParquet(data.file, data.network) }); }
  catch { postMessage({ error: 'Unable to verify the bounded retained Parquet export.' }); }
});
