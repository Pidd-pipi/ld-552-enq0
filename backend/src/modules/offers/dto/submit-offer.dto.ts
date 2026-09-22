import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class SubmitOfferDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;
}
