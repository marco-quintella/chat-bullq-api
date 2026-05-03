import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Tri-state override de IA por canal:
   *   null  = segue org.aiEnabled
   *   true  = força IA ON nesse canal
   *   false = força IA OFF nesse canal
   * Permite o operador desligar a IA num canal específico sem mexer no toggle global.
   */
  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Override por canal: null=segue org, true=força ON, false=força OFF',
  })
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean | null;
}
