/**
 * Streaming example — wrap HELIOS events as server-sent events.
 *
 * Drop this into any Node HTTP handler to expose HELIOS over SSE.
 */

import http from 'node:http';
import { HeliosHarness, toSSE } from '../src/index.js';

const helios = new HeliosHarness({
  provider: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    apiKey:  process.env.OPENAI_API_KEY  ?? '',
    model:   process.env.HELIOS_MODEL    ?? 'meta/llama-3.3-70b-instruct',
  },
  e2b: { apiKey: process.env.E2B_API_KEY ?? '', template: 'helios-base' },
});

http.createServer(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const session = await helios.startSession('http-demo');
  try {
    for await (const ev of session.exec('shell', { command: 'ls -la /home/user/work' })) {
      res.write(toSSE(ev));
    }
  } finally {
    await session.close();
    res.end();
  }
}).listen(3000, () => console.log('listening on :3000'));
