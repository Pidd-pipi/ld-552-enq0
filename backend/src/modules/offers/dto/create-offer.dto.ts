import { IsDateString, IsInt, IsNumber, IsPositive } from 'class-validator';

export class CreateOfferDto {
  @IsInt()
  candidateId: number;

  @IsInt()
  jobId: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  salary: number;

  @IsDateString()
  startDate: string;
}
