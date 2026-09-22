import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveOfferDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
