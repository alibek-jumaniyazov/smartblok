import { Allow } from 'class-validator';

/**
 * PUT /settings/:key body. The value's shape depends on the key
 * (number | numeric string | null), so per-key validation lives in
 * SettingsAdminService; @Allow keeps the field past the whitelist pipe.
 */
export class UpdateSettingDto {
  @Allow()
  value?: number | string | null;
}
