import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectApprovalDto {
  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;
}
