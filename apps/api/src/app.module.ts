import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DbModule } from './db/db.module';
import { AuthGuard } from './common/auth';
import { AllExceptionsFilter } from './common/http';
import { AuthModule } from './modules/auth/auth.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';
import { BranchesModule } from './modules/branches/branches.module';
import { FamiliesModule } from './modules/families/families.module';
import { StudentsModule } from './modules/students/students.module';
import { RequestsModule } from './modules/requests/requests.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuditModule } from './modules/audit/audit.module';
import { ExportModule } from './modules/export/export.module';
import { ImportModule } from './modules/import/import.module';
import { HafalanModule } from './modules/hafalan/hafalan.module';
import { BillingModule } from './modules/billing/billing.module';
import { LpsModule } from './modules/lps/lps.module';
import { PortalModule } from './modules/portal/portal.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SubsidiesModule } from './modules/subsidies/subsidies.module';
import { AgendaModule } from './modules/agenda/agenda.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { KasModule } from './modules/kas/kas.module';

@Module({
  imports: [
    DbModule, JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]), // batas umum per IP
    AuthModule, RolesModule, UsersModule, BranchesModule, FamiliesModule, StudentsModule, RequestsModule, DashboardModule, AuditModule, ExportModule, ImportModule,
    HafalanModule, BillingModule, LpsModule, PortalModule, SettingsModule, SubsidiesModule, AgendaModule, RegistrationModule, KasModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
