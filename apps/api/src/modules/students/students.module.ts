import { Body, Controller, Get, Module, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { StudentsService } from './students.service';
import { RequestDto, StatusDto, StudentDto, UpdateStudentDto } from './students.dto';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { FamiliesModule } from '../families/families.module';

@Controller('students')
export class StudentsController {
  constructor(private s: StudentsService) {}
  @Get() @Perm('santri.lihat') list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.s.list(u, q); }
  @Get(':id') @Perm('santri.lihat') get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.get(u, id); }
  @Post() @Perm('santri.input') create(@CurrentUser() u: AuthUser, @Body() dto: StudentDto) { return this.s.create(u, dto); }
  @Patch(':id') @Perm('santri.edit') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStudentDto) { return this.s.update(u, id, dto); }
  @Post(':id/status') @Perm('santri.edit') status(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) { return this.s.setStatus(u, id, dto); }
  @Post(':id/requests') @Perm('pengajuan.input') request(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RequestDto) { return this.s.createRequest(u, id, dto); }
}

@Module({ imports: [FamiliesModule], controllers: [StudentsController], providers: [StudentsService, AuditService], exports: [StudentsService] })
export class StudentsModule {}
