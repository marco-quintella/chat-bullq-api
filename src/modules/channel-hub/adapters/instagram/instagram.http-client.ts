import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

interface InstagramConfig {
  accessToken: string;
  igBusinessId?: string;
  appSecret?: string;
  apiVersion?: string;
}

@Injectable()
export class InstagramHttpClient {
  private readonly logger = new Logger(InstagramHttpClient.name);

  private getConfig(channel: Channel): InstagramConfig {
    const config = channel.config as Record<string, any>;
    return {
      accessToken: config.accessToken || config.pageAccessToken,
      igBusinessId: config.igBusinessId || config.igUserId,
      appSecret: config.appSecret,
      apiVersion: config.apiVersion || 'v21.0',
    };
  }

  private createClient(channel: Channel): AxiosInstance {
    const cfg = this.getConfig(channel);
    return axios.create({
      baseURL: `https://graph.instagram.com/${cfg.apiVersion}`,
      params: { access_token: cfg.accessToken },
      timeout: 30000,
    });
  }

  async getMe(channel: Channel): Promise<any> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.get('/me', {
        params: { fields: 'id,user_id,username,account_type,name' },
      });
      return data;
    } catch (err: any) {
      throw this.wrapGraphError(err, 'getMe');
    }
  }

  async resolveBusinessId(channel: Channel): Promise<string | null> {
    const cfg = this.getConfig(channel);
    if (cfg.igBusinessId) return cfg.igBusinessId;
    try {
      const info = await this.getMe(channel);
      return info?.user_id ?? info?.id ?? null;
    } catch {
      return null;
    }
  }

  async sendMessage(
    channel: Channel,
    payload: Record<string, any>,
  ): Promise<any> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.post('/me/messages', payload);
      return data;
    } catch (err: any) {
      throw this.wrapGraphError(err, 'sendMessage');
    }
  }

  async listConversations(
    channel: Channel,
    cursor?: string,
    limit = 50,
  ): Promise<{ data: any[]; nextCursor?: string }> {
    const client = this.createClient(channel);
    const params: Record<string, any> = {
      platform: 'instagram',
      fields: 'id,updated_time,participants',
      limit,
    };
    if (cursor) params.after = cursor;

    try {
      const { data } = await client.get('/me/conversations', { params });
      return {
        data: data?.data ?? [],
        nextCursor: data?.paging?.cursors?.after && data?.paging?.next ? data.paging.cursors.after : undefined,
      };
    } catch (err: any) {
      throw this.wrapGraphError(err, 'listConversations');
    }
  }

  async listConversationMessages(
    channel: Channel,
    conversationId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ data: any[]; nextCursor?: string }> {
    const client = this.createClient(channel);
    const params: Record<string, any> = {
      fields: 'id,created_time,from,to,message,attachments,shares,story,reactions',
      limit,
    };
    if (cursor) params.after = cursor;

    try {
      const { data } = await client.get(`/${conversationId}/messages`, { params });
      return {
        data: data?.data ?? [],
        nextCursor: data?.paging?.cursors?.after && data?.paging?.next ? data.paging.cursors.after : undefined,
      };
    } catch (err: any) {
      throw this.wrapGraphError(err, 'listConversationMessages');
    }
  }

  async getUserProfile(channel: Channel, igUserId: string): Promise<any> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.get(`/${igUserId}`, {
        params: { fields: 'name,username,profile_pic' },
      });
      return data;
    } catch (err: any) {
      throw this.wrapGraphError(err, 'getUserProfile');
    }
  }

  async getMessageDetail(channel: Channel, messageId: string): Promise<any> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.get(`/${messageId}`, {
        params: { fields: 'id,created_time,from,to,message,attachments,shares,story' },
      });
      return data;
    } catch (err: any) {
      throw this.wrapGraphError(err, 'getMessageDetail');
    }
  }

  async downloadMedia(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  private wrapGraphError(err: any, context: string): Error {
    const metaError = err?.response?.data?.error;
    if (metaError) {
      const code = metaError.code !== undefined ? `[#${metaError.code}] ` : '';
      const subcode = metaError.error_subcode ? ` (subcode ${metaError.error_subcode})` : '';
      const msg = metaError.message || 'Unknown Meta error';
      this.logger.error(`Instagram ${context} failed: ${code}${msg}${subcode}`);
      return new Error(`Meta Graph API: ${code}${msg}${subcode}`);
    }
    this.logger.error(`Instagram ${context} failed: ${err.message}`);
    return err;
  }
}
