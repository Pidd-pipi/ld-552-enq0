import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class UpdateOfferDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  salary?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;
}
