import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  MessageContentType,
  StatusUpdate,
} from '../../ports/types';

@Injectable()
export class InstagramMessageMapper {
  normalizeInbound(messaging: Record<string, any>): NormalizedInboundMessage | null {
    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id;
    const message = messaging.message;
    if (!senderId || !message) return null;

    const isEcho = !!message.is_echo;
    // For echo events (sent from IG app by our account), the "contact" is the recipient,
    // not the sender (which is us).
    const externalContactId = isEcho ? recipientId : senderId;
    if (!externalContactId) return null;

    const result: NormalizedInboundMessage = {
      externalMessageId: message.mid,
      externalContactId,
      channelType: ChannelType.INSTAGRAM,
      timestamp: new Date(messaging.timestamp),
      type: this.resolveContentType(message),
      content: this.extractContent(message),
      isEcho,
      rawPayload: messaging,
    };

    // Instagram reply contexts. `reply_to` may contain:
    //   - mid (reply to a message)
    //   - story { id, url } (reply to a story) — our core use case
    //   - ad    { id, title } (reply to an ad)
    // Story mentions arrive as attachments[type=story_mention] with a CDN url.
    const replyTo = this.extractReplyContext(message);
    if (replyTo) {
      result.replyTo = replyTo;
    }

    return result;
  }

  private extractReplyContext(message: Record<string, any>): NormalizedInboundMessage['replyTo'] | undefined {
    const rt = message.reply_to;
    if (rt?.story?.id || rt?.story?.url) {
      return {
        story: {
          id: rt.story.id ? String(rt.story.id) : undefined,
          url: rt.story.url,
          kind: 'reply',
        },
      };
    }
    if (rt?.ad?.id) {
      return { ad: { id: String(rt.ad.id), title: rt.ad.title } };
    }
    if (rt?.mid) {
      return { externalMessageId: String(rt.mid) };
    }
    // Story mention: surfaces as a standalone attachment, not as reply_to.
    const attachment = message.attachments?.[0];
    if (attachment?.type === 'story_mention') {
      return {
        story: {
          url: attachment.payload?.url,
          kind: 'mention',
        },
      };
    }
    return undefined;
  }

  normalizeStatus(messaging: Record<string, any>): StatusUpdate | null {
    const delivery = messaging.delivery;
    if (!delivery?.mids?.length) return null;

    return {
      externalMessageId: delivery.mids[0],
      status: 'delivered',
      timestamp: new Date(messaging.timestamp),
    };
  }

  /**
   * Meta sends `read` with a `watermark` timestamp (no mids).
   * We use the watermark to flip status to READ for every matching outbound
   * message up to that timestamp — the processor handles the bulk update.
   */
  normalizeReadStatus(messaging: Record<string, any>): StatusUpdate | null {
    const read = messaging.read;
    if (!read?.watermark) return null;
    return {
      externalMessageId: `ig-read-watermark:${read.watermark}`,
      status: 'read',
      timestamp: new Date(Number(read.watermark) || messaging.timestamp),
    };
  }

  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): Record<string, any> {
    const base = { recipient: { id: contactExternalId } };

    switch (message.type) {
      case MessageContentType.TEXT:
        return { ...base, message: { text: message.content.text } };

      case MessageContentType.IMAGE:
        return {
          ...base,
          message: {
            attachment: {
              type: 'image',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          },
        };

      case MessageContentType.AUDIO:
        return {
          ...base,
          message: {
            attachment: {
              type: 'audio',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          },
        };

      case MessageContentType.VIDEO:
        return {
          ...base,
          message: {
            attachment: {
              type: 'video',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          },
        };

      case MessageContentType.DOCUMENT:
        return {
          ...base,
          message: {
            attachment: {
              type: 'file',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          },
        };

      default:
        return { ...base, message: { text: message.content.text || '' } };
    }
  }

  private resolveContentType(msg: Record<string, any>): MessageContentType {
    if (msg.text) return MessageContentType.TEXT;
    if (msg.attachments?.length) {
      const type = msg.attachments[0].type;
      const map: Record<string, MessageContentType> = {
        image: MessageContentType.IMAGE,
        audio: MessageContentType.AUDIO,
        video: MessageContentType.VIDEO,
        file: MessageContentType.DOCUMENT,
        share: MessageContentType.TEXT,
        story_mention: MessageContentType.TEXT,
        reel: MessageContentType.VIDEO,
      };
      return map[type] || MessageContentType.TEXT;
    }
    return MessageContentType.TEXT;
  }

  private extractContent(msg: Record<string, any>): NormalizedInboundMessage['content'] {
    if (msg.text) {
      return { text: msg.text };
    }

    if (msg.attachments?.length) {
      const att = msg.attachments[0];
      const payload = att.payload || {};

      switch (att.type) {
        case 'image':
          return { mediaUrl: payload.url, mimeType: 'image/jpeg' };
        case 'audio':
          return { mediaUrl: payload.url, mimeType: 'audio/mp4' };
        case 'video':
        case 'reel':
          return { mediaUrl: payload.url, mimeType: 'video/mp4' };
        case 'file':
          return { mediaUrl: payload.url };
        case 'share':
          return { text: payload.url || '[Shared content]' };
        case 'story_mention':
          return { text: '[Story mention]', mediaUrl: payload.url };
        default:
          return { text: `[${att.type}]` };
      }
    }

    return { text: '[Unsupported message]' };
  }
}
