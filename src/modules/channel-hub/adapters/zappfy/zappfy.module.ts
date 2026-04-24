import { Module } from '@nestjs/common';
import { ZappfyInboundAdapter } from './zappfy.inbound-adapter';
import { ZappfyOutboundAdapter } from './zappfy.outbound-adapter';
import { ZappfyMessageMapper } from './zappfy.message-mapper';
import { ZappfyHttpClient } from './zappfy.http-client';
import { ZappfySyncAdapter } from './zappfy.sync-adapter';

@Module({
  providers: [
    ZappfyInboundAdapter,
    ZappfyOutboundAdapter,
    ZappfyMessageMapper,
    ZappfyHttpClient,
    ZappfySyncAdapter,
  ],
  exports: [
    ZappfyInboundAdapter,
    ZappfyOutboundAdapter,
    ZappfyHttpClient,
    ZappfySyncAdapter,
  ],
})
export class ZappfyModule {}
