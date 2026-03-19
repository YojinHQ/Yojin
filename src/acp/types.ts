import { z } from 'zod';

export const AcpSessionSchema = z.object({
  sessionId: z.string().uuid(),
  threadId: z.string(),
  cwd: z.string(),
  userId: z.string().default('local'),
  createdAt: z.number(),
});

export type AcpSession = z.infer<typeof AcpSessionSchema>;
