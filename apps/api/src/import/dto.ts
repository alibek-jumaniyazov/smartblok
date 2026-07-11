import { IsBoolean } from 'class-validator';

export class RollbackDto {
  /** must be literally true — the service refuses anything else */
  @IsBoolean()
  confirm!: boolean;
}
