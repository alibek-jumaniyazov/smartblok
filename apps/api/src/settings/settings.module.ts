import { Module } from '@nestjs/common';
import { SettingsAdminService } from './settings-admin.service';
import { SettingsController } from './settings.controller';

@Module({ providers: [SettingsAdminService], controllers: [SettingsController] })
export class SettingsModule {}
