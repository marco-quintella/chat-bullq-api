import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NormalizedOutboundMessage } from '../../channel-hub/ports/types';
import { IdempotencyService } from './idempotency.service';

interface OutboundJobData {
  messageId: string;
  channelId: string;
  contactExternalId: string;
  message: NormalizedOutboundMessage;
}

@Processor('outbound-messages', { concurrency: 5 })
export class OutboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundMessageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly idempotency: IdempotencyService,
  ) {
    super();
  }

  async process(job: Job<OutboundJobData>): Promise<any> {
    const { messageId, channelId, contactExternalId, message } = job.data;

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
    });

    const adapter = this.adapterRegistry.getOutbound(channel.type);

    try {
      const result = await adapter.sendMessage(
        channel,
        contactExternalId,
        message,
      );

      // Persist externalId FIRST, then mark idempotency so that a subsequent
      // echo webhook for the same externalId is recognised as a duplicate
      // instead of creating a phantom row.
      let updated;
      try {
        updated = await this.prisma.message.update({
          where: { id: messageId },
          data: {
            status: MessageStatus.SENT,
            externalId: result.externalId || null,
            sentAt: new Date(),
            metadata: {
              providerResponse: safeJson(result.providerResponse),
            },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && result.externalId) {
          // A webhook echo raced us and already inserted a row with this
          // externalId. Merge: delete our QUEUED placeholder and reuse the
          // echo row so there is a single source-of-truth.
          this.logger.warn(
            `Outbound echo race on ${result.externalId} — merging into existing row`,
          );
          const placeholder = await this.prisma.message.findUnique({
            where: { id: messageId },
          });
          const echoRow = await this.prisma.message.findFirst({
            where: {
              externalId: result.externalId,
              id: { not: messageId },
            },
          });
          if (echoRow && placeholder) {
            // Copy senderId + content from placeholder to echo row. Echo has
            // no sender, and for media messages the echo's content lacks the
            // playable mediaUrl (WhatsApp echoes an encrypted .enc CDN URL
            // that browsers cannot decrypt). Our placeholder already has the
            // locally-hosted URL we uploaded — that is the authoritative one.
            const patch: Record<string, any> = {};
            if (placeholder.senderId && !echoRow.senderId) {
              patch.senderId = placeholder.senderId;
            }
            const placeholderContent = placeholder.content as any;
            if (placeholderContent?.mediaUrl) {
              patch.content = placeholderContent;
            }
            if (Object.keys(patch).length > 0) {
              await this.prisma.message.update({
                where: { id: echoRow.id },
                data: patch,
              });
            }
            await this.prisma.message
              .delete({ where: { id: messageId } })
              .catch(() => undefined);
            updated = await this.prisma.message.findUniqueOrThrow({
              where: { id: echoRow.id },
            });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (result.externalId) {
        await this.idempotency.markProcessed(result.externalId, channelId);
      }

      this.emitStatusUpdate(updated.conversationId, updated.id, MessageStatus.SENT);
      this.realtimeGateway.emitToOrg(channel.organizationId, 'message:new', {
        message: updated,
        conversationId: updated.conversationId,
      });
      this.logger.log(
        `Outbound sent: msg=${updated.id} externalId=${result.externalId}`,
      );

      return { success: true, externalId: result.externalId };
    } catch (error: any) {
      this.logger.error(
        `Outbound failed: msg=${messageId} - ${error.message}`,
      );
      const updated = await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          failedReason: error.message?.slice?.(0, 500) ?? String(error),
        },
      });

      this.emitStatusUpdate(
        updated.conversationId,
        messageId,
        MessageStatus.FAILED,
      );
      throw error;
    }
  }

  private emitStatusUpdate(
    conversationId: string,
    messageId: string,
    status: MessageStatus,
  ) {
    const payload = { messageId, status, conversationId };
    this.realtimeGateway.emitToConversation(
      conversationId,
      'message:status',
      payload,
    );
  }
}

function safeJson(value: unknown): any {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}
