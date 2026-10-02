import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Chat } from '@/components/agent/chat';
import { db } from '@/db/client';
import { env } from '@/env';
import { getIdentity } from '@/identity';
import { referenceOf } from '@/reference';
import { conversationTurns, NotFoundError } from '@/runs/service';

/** Render a new chat or restore an owned conversation from its URL identifier. Malformed, missing and foreign conversation IDs render not-found rather than exposing another transcript. */
export default async function Page({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const { conversation } = await searchParams;
  const reference = referenceOf();
  if (!conversation) return <Chat reference={reference} />;
  if (!z.uuid().safeParse(conversation).success) notFound();
  const config = env();
  const who = getIdentity(await headers(), {
    adapter: config.IDENTITY_ADAPTER,
    header: config.IDENTITY_HEADER,
    secret: config.IDENTITY_HEADER_SECRET,
  });
  try {
    return (
      <Chat
        reference={reference}
        initialConversationId={conversation}
        initialTurns={await conversationTurns(db, who, conversation)}
      />
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
