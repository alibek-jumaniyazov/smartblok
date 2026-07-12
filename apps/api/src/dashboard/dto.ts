import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Owner/agent cockpit period window (Tashkent days). Both bounds optional;
 *  the service defaults to «month start → today» when absent. */
export class SummaryQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: "from formati YYYY-MM-DD bo'lishi kerak" })
  from?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: "to formati YYYY-MM-DD bo'lishi kerak" })
  to?: string;
}

export class TrendsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;

  // Explicit date-to-date window (wins over `days` when provided).
  @IsOptional()
  @Matches(DATE_RE, { message: "from formati YYYY-MM-DD bo'lishi kerak" })
  from?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: "to formati YYYY-MM-DD bo'lishi kerak" })
  to?: string;
}

export class AgentsRankingQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "month formati YYYY-MM bo'lishi kerak" })
  month?: string;
}
