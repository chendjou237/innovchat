import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PromotionInput, promotionSchema } from '@innovcare/shared';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { ZodPipe } from '../core/zod.pipe';
import { PromotionsService } from './promotions.service';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: Partial<PromotionInput>) {
    return this.promotions.preview(body ?? {});
  }

  @Post('commit')
  @HttpCode(200)
  commit(@CurrentUser() me: SessionUser, @Body(new ZodPipe(promotionSchema)) body: PromotionInput) {
    return this.promotions.commit(body, me.id);
  }
}
