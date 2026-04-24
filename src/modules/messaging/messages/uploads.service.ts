import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

export interface UploadResult {
  url: string;
  mimeType: string;
  size: number;
  filename: string;
}

/**
 * Stores agent-uploaded media (audio today, images/video later) on the local
 * filesystem under `uploads/` and returns a public URL that the app serves
 * from `/api/v1/uploads/*`.
 *
 * Swap this with S3/R2 when we move to multi-instance deployment — the public
 * URL contract stays the same.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  // 25MB matches OpenAI Whisper's upload cap, so audios we accept are also
  // transcribable without chunking.
  static readonly MAX_AUDIO_BYTES = 25 * 1024 * 1024;

  private static readonly ALLOWED_AUDIO_MIME = new Set([
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/webm;codecs=opus',
  ]);

  private readonly rootDir: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.rootDir = path.resolve(
      this.config.get<string>('UPLOADS_DIR') ||
        path.join(process.cwd(), 'uploads'),
    );
    const appUrl = this.config.get<string>('APP_URL') || '';
    this.publicBaseUrl = `${appUrl.replace(/\/$/, '')}/api/v1/uploads`;
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  async saveAudio(file: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  }): Promise<UploadResult> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Empty upload');
    }
    if (file.buffer.byteLength > UploadsService.MAX_AUDIO_BYTES) {
      throw new BadRequestException(
        `Audio too large (max ${UploadsService.MAX_AUDIO_BYTES / 1024 / 1024}MB)`,
      );
    }
    // Normalise mimetype: browsers sometimes send `audio/webm;codecs=opus`.
    const mime = (file.mimetype || '').split(';')[0].trim() || 'audio/webm';
    if (!UploadsService.ALLOWED_AUDIO_MIME.has(file.mimetype) && !UploadsService.ALLOWED_AUDIO_MIME.has(mime)) {
      throw new BadRequestException(`Unsupported audio mime type: ${file.mimetype}`);
    }

    const dateFolder = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.rootDir, 'audio', dateFolder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const id = crypto.randomBytes(16).toString('hex');
    const srcExt = this.extFor(mime);
    const srcPath = path.join(dir, `${id}${srcExt}`);
    await fs.promises.writeFile(srcPath, file.buffer);

    // WhatsApp voice notes require OGG/Opus. Browsers (esp. Chrome/Firefox)
    // record in WebM/Opus via MediaRecorder — the codec is compatible but
    // the container is not, so Zappfy rejects the send (HTTP 500). We also
    // rely on the re-encode to write proper duration headers (MediaRecorder
    // streams webm without duration, so the <audio> element shows 0:00).
    let finalPath = srcPath;
    let finalMime = mime;
    if (mime !== 'audio/ogg') {
      const oggPath = path.join(dir, `${id}.ogg`);
      try {
        await execFileAsync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', srcPath,
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-ac', '1',
            '-ar', '48000',
            '-application', 'voip',
            oggPath,
          ],
          { timeout: 30_000 },
        );
        await fs.promises.unlink(srcPath).catch(() => undefined);
        finalPath = oggPath;
        finalMime = 'audio/ogg';
      } catch (err: any) {
        this.logger.error(`ffmpeg transcode failed: ${err.message}`);
        throw new BadRequestException('Failed to process audio');
      }
    }

    const finalSize = (await fs.promises.stat(finalPath)).size;
    const finalName = path.basename(finalPath);
    const url = `${this.publicBaseUrl}/audio/${dateFolder}/${finalName}`;
    this.logger.log(`Audio saved: ${finalPath} -> ${url}`);
    return { url, mimeType: finalMime, size: finalSize, filename: finalName };
  }

  private extFor(mime: string): string {
    if (mime.includes('ogg')) return '.ogg';
    if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
    if (mime.includes('wav')) return '.wav';
    if (mime.includes('webm')) return '.webm';
    return '.mp3';
  }
}
