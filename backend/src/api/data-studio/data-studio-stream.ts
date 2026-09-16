import { Request, Response } from 'express';
import { DataStudioService } from './data-studio.service';
export async function streamData(req: Request, res: Response, service: DataStudioService) {
  await service.refresh();
  const cursor = req.get('Last-Event-ID') ?? (typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const backlog = service.eventsAfter(cursor);
  let closed = false;
  let off: () => unknown = () => undefined;
  let poll: NodeJS.Timeout | undefined;
  let life: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    off();
    if (poll) clearInterval(poll);
    if (life) clearTimeout(life);
  };
  const end = () => {
    cleanup();
    res.end();
  };
  const write = (frame: string) => {
    if (closed) return;
    if (Buffer.byteLength(frame) > 65536 || res.writableLength > 65536) {
      cleanup();
      res.destroy();
      return;
    }
    try {
      if (!res.write(frame)) {
        cleanup();
        res.destroy();
      }
    } catch {
      cleanup();
    }
  };
  off = service.subscribe((event) =>
    write(`id: ${event.id}\nevent: data.snapshot\ndata: ${JSON.stringify(event)}\n\n`)
  );
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  for (const event of backlog) write(`id: ${event.id}\nevent: data.snapshot\ndata: ${JSON.stringify(event)}\n\n`);
  poll = setInterval(() => {
    void service.refresh().catch(() => {
      write(
        'event: data.source-unavailable\ndata: {"scope":"Owned source refresh failed; no new snapshot claimed."}\n\n'
      );
      end();
    });
    write(': poll heartbeat\n\n');
  }, 5000);
  poll.unref();
  life = setTimeout(end, 300000);
  life.unref();
  if (closed) {
    clearInterval(poll);
    clearTimeout(life);
  }
}
