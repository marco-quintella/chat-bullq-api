import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../../database/prisma.module';
import { PendingActionStorage } from './pending-action.storage';
import { PendingActionService } from './pending-action.service';
import { PendingActionController } from './pending-action.controller';
import { PENDING_ACTION_EXECUTOR_QUEUE } from './pending-action-executor.processor';

const executorQueue = BullModule.registerQueue({
  name: PENDING_ACTION_EXECUTOR_QUEUE,
});

/**
 * Destructive-action confirmation module — apenas CRUD + ciclo de aprovação.
 *
 * NÃO contém o executor (`PendingActionExecutorProcessor`) nem o cron
 * (`PendingActionCronService`) — esses ficam em `ConfirmationExecutorModule`
 * pra quebrar o ciclo Tools→Confirmations→Tools.
 *
 * Re-exporta a queue pra que `PendingActionService` consiga `@InjectQueue`.
 */
@Module({
  imports: [PrismaModule, executorQueue],
  controllers: [PendingActionController],
  providers: [PendingActionStorage, PendingActionService],
  exports: [PendingActionService, executorQueue],
})
export class ConfirmationsModule {}
