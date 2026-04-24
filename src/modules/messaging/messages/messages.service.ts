import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MessageDirection,
  MessageContentType,
  MessageStatus,
} from '@prisma/client';
import { MessagesRepository } from './messages.repository';
import { SendMessageDto } from './dto/send-message.dto';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class MessagesService {
  constructor(
    private readonly repository: MessagesRepository,
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  async send(dto: SendMessageDto, senderId: string, organizationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
      include: {
        channel: true,
        contact: { include: { channels: true } },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }

    const contactChannel = conversation.contact.channels.find(
      (cc) => cc.channelId === conversation.channelId,
    );
    if (!contactChannel) {
      throw new NotFoundException('Contact channel not found');
    }

    const message = await this.repository.create({
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: dto.type as MessageContentType,
      content: dto.content,
      status: MessageStatus.QUEUED,
      senderId,
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Optimistic realtime: everyone in the org/conversation sees the outbound
    // QUEUED row instantly, independent of the outbound worker roundtrip.
    this.realtimeGateway.emitToOrg(organizationId, 'message:new', {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtimeGateway.emitToConversation(conversation.id, 'message:new', {
      message,
    });

    let outboundContent = dto.content;
    if (conversation.isGroup && dto.type === 'TEXT' && outboundContent.text) {
      const sender = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true },
      });
      if (sender?.name) {
        outboundContent = {
          ...outboundContent,
          text: `*${sender.name}*\n${outboundContent.text}`,
        };
      }
    }

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: conversation.channelId,
        contactExternalId: contactChannel.externalId,
        message: {
          type: dto.type,
          content: outboundContent,
          replyTo: dto.replyTo,
        },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return message;
  }

  async findByConversation(
    conversationId: string,
    organizationId: string,
    page: number,
    limit: number,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }

    const skip = (page - 1) * limit;
    const { messages, total } = await this.repository.findByConversation(
      conversationId,
      skip,
      limit,
    );

    return {
      messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
