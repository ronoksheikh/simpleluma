import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Send a file with HTTP range support, so video can be scrubbed in the browser. */
export async function sendFileWithRanges(req: FastifyRequest, reply: FastifyReply, file: string, type: string, downloadName?: string): Promise<FastifyReply> {
  const { size } = await stat(file);
  reply.header('accept-ranges', 'bytes').type(type);
  if (downloadName) reply.header('content-disposition', `attachment; filename="${downloadName.replace(/[^\w.-]+/g, '_')}"`);
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!match || (!match[1] && !match[2])) return reply.header('content-length', size).send(createReadStream(file));
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) return reply.status(416).header('content-range', `bytes */${size}`).send();
  return reply
    .status(206)
    .header('content-range', `bytes ${start}-${end}/${size}`)
    .header('content-length', end - start + 1)
    .send(createReadStream(file, { start, end }));
}
