import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Db } from '../../db/db.module';
import type { PoolClient } from 'pg';
import { assertBranch } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { FAMILY_SENSITIVE, STUDENT_SENSITIVE, canSeeSensitive, mask } from '../../common/mask';
import { today } from '../../common/sql';
import { FamiliesService } from '../families/families.module';
import { SubsidiesService } from '../subsidies/subsidies.module';
import { RequestDto, StatusDto, StudentDto, UpdateStudentDto } from './students.dto';

const SCOPE = `($1::int[] IS NULL OR s.branch_id = ANY($1))`;
const S_COLS = `s.id, s.nis, s.full_name AS "fullName", s.nickname, s.gender, s.birth_place AS "birthPlace", s.birth_date AS "birthDate", s.school,
  s.family_id AS "familyId", s.branch_id AS "branchId", s.class_id AS "classId", s.join_date AS "joinDate", s.status, s.health_notes AS "healthNotes",
  s.spp_rate AS "sppRate", s.subsidy_label AS "subsidyLabel", s.subsidy_id AS "subsidyId", s.subsidy_since AS "subsidySince", s.registration_note AS "registrationNote", s.archived_at AS "archivedAt", s.created_at AS "createdAt"`;
// Kolom daftar = kolom spreadsheet data santri (ID Santri … Pekerjaan Ibu); field sensitif dimasking di list()
/** Santri baru. Status CUTI/KELUAR hanya lewat impor data lama (form tambah santri tetap INDENT/AKTIF, divalidasi StudentDto). */
export type NewStudent = Omit<StudentDto, 'status'> & { status: StudentDto['status'] | 'CUTI' | 'KELUAR' };
const LIST_COLS = `s.id, s.nis, s.full_name AS "fullName", s.nickname, s.gender, s.birth_place AS "birthPlace", s.birth_date AS "birthDate",
  s.branch_id AS "branchId", b.name AS "branchName", s.class_id AS "classId", c.level, c.name AS "className", s.join_date AS "joinDate", s.status,
  s.registration_note AS "registrationNote", s.subsidy_label AS "subsidyLabel", s.family_id AS "familyId", f.father_name AS "fatherName", f.mother_name AS "motherName",
  f.wa_phone AS "waPhone", f.address, f.father_job AS "fatherJob", f.mother_job AS "motherJob"`;

@Injectable()
export class StudentsService {
  constructor(
    private db: Db,
    private audit: AuditService,
    private fam: FamiliesService,
    private subsidies: SubsidiesService,
  ) {}

  /**
   * ID santri: RTA-<kode cabang pendaftaran>-<urut per cabang, min. 3 digit>. Contoh: RTA-GNK-001.
   * Tidak berubah saat mutasi (kode = cabang tempat mendaftar). Wajib dipanggil di dalam transaksi: kunci per cabang mencegah nomor ganda.
   */
  private async nextNis(branchId: number, client: any) {
    const b = await this.db.one('SELECT code FROM branches WHERE id = $1', [branchId], client);
    const prefix = `RTA-${b!.code}-`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefix]);
    const r = await this.db.one(`SELECT COALESCE(MAX(substring(nis FROM '^RTA-[A-Z]+-([0-9]+)$')::int), 0) AS n FROM students WHERE nis LIKE $1`, [`${prefix}%`], client);
    return prefix + String(r!.n + 1).padStart(3, '0');
  }

  async list(user: AuthUser, p: { q?: string; branchId?: number; classId?: number; status?: string; page?: number; size?: number }) {
    const size = Math.min(Number(p.size ?? 25), 100),
      page = Math.max(Number(p.page ?? 1), 1);
    const params = [user.branchIds, p.branchId ? Number(p.branchId) : null, p.classId ? Number(p.classId) : null, p.status || null, p.q ? `%${p.q}%` : null];
    const where = `WHERE ${SCOPE} AND ($2::int IS NULL OR s.branch_id = $2) AND ($3::int IS NULL OR s.class_id = $3) AND ($4::text IS NULL OR s.status = $4)
                   AND ($5::text IS NULL OR s.full_name ILIKE $5 OR s.nis ILIKE $5 OR s.legacy_nis ILIKE $5)`;
    const rows = await this.db.many(
      `SELECT ${LIST_COLS}
       FROM students s JOIN branches b ON b.id = s.branch_id JOIN classes c ON c.id = s.class_id JOIN families f ON f.id = s.family_id
       ${where} ORDER BY s.full_name LIMIT $6 OFFSET $7`,
      [...params, size, (page - 1) * size],
    );
    const t = await this.db.one(`SELECT COUNT(*)::int AS total FROM students s ${where}`, params);
    // jumlah per status untuk tab (filter lain tetap berlaku, filter status diabaikan)
    const byStatus = await this.db.many(`SELECT s.status, COUNT(*)::int AS n FROM students s ${where} GROUP BY s.status`, [params[0], params[1], params[2], null, params[4]]);
    const counts: Record<string, number> = { '': 0, AKTIF: 0, CUTI: 0, INDENT: 0, KELUAR: 0 };
    for (const r of byStatus) {
      counts[r.status] = r.n;
      counts[''] += r.n;
    }
    // kategori subsidi tidak dikirim sama sekali ke role non-sensitif (null vs "Disembunyikan" pun membocorkan siapa yang disubsidi)
    const out = rows.map((r) => {
      const m = mask(user, r, [...STUDENT_SENSITIVE, ...FAMILY_SENSITIVE]);
      if (!canSeeSensitive(user)) delete m.subsidyLabel;
      return m;
    });
    return { rows: out, total: t?.total ?? 0, page, size, counts };
  }

  async get(user: AuthUser, id: number) {
    const s = await this.db.one(`SELECT ${S_COLS} FROM students s WHERE s.id = $2 AND ${SCOPE}`, [user.branchIds, id]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    const f = await this.db.one(
      `SELECT id, father_name AS "fatherName", mother_name AS "motherName", guardian_name AS "guardianName", guardian_relation AS "guardianRelation",
              wa_phone AS "waPhone", backup_phone AS "backupPhone", address, father_job AS "fatherJob", mother_job AS "motherJob" FROM families WHERE id = $1`,
      [s.familyId],
    );
    const b = await this.db.one('SELECT id, code, name, spp_standard AS "sppStandard" FROM branches WHERE id = $1', [s.branchId]);
    const c = await this.db.one('SELECT id, level, name FROM classes WHERE id = $1', [s.classId]);
    const placements = await this.db.many(
      `SELECT p.id, p.effective_date AS "effectiveDate", b.name AS "branchName", c.name AS "className", p.note
       FROM student_placements p JOIN branches b ON b.id = p.branch_id JOIN classes c ON c.id = p.class_id WHERE p.student_id = $1 ORDER BY p.effective_date DESC, p.id DESC`,
      [id],
    );
    const history = await this.db.many(
      `SELECT h.id, h.from_status AS "fromStatus", h.to_status AS "toStatus", h.effective_date AS "effectiveDate", h.reason, h.note, u.name AS actor, h.created_at AS "createdAt"
       FROM status_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.student_id = $1 ORDER BY h.created_at DESC`,
      [id],
    );
    const requests = await this.db.many(
      `SELECT id, type, state, effective_date AS "effectiveDate", reason, target_branch_id AS "targetBranchId", target_class_id AS "targetClassId", note,
              decision_note AS "decisionNote", created_at AS "createdAt", decided_at AS "decidedAt" FROM requests WHERE student_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    const siblings = await this.db.many('SELECT id, full_name AS "fullName", status FROM students WHERE family_id = $1 AND id <> $2', [s.familyId, id]);
    const branchClasses = await this.db.many('SELECT id, level, name FROM classes WHERE branch_id = $1 ORDER BY level DESC', [s.branchId]);
    const st = mask(user, s, STUDENT_SENSITIVE);
    if (!canSeeSensitive(user)) {
      delete st.subsidyLabel;
      delete st.subsidyId;
      delete st.subsidySince;
    }
    return {
      ...st,
      branch: b,
      class: c,
      branchClasses,
      family: mask(user, f!, FAMILY_SENSITIVE),
      placements,
      history,
      requests,
      siblings,
      age: Math.floor((Date.now() - new Date(s.birthDate).getTime()) / (365.25 * 86400_000)),
    };
  }

  private async validClass(branchId: number, classId: number, client?: any) {
    const c = await this.db.one('SELECT id FROM classes WHERE id = $1 AND branch_id = $2', [classId, branchId], client);
    if (!c) throw new BadRequestException('Kelas tidak tersedia di cabang tersebut');
  }

  /** `client`: jalankan di dalam transaksi pemanggil (impor: semua baris tersimpan atau tidak sama sekali). */
  async create(user: AuthUser, dto: NewStudent, client?: PoolClient) {
    assertBranch(user, dto.branchId);
    if (!dto.familyId && !dto.family) throw new BadRequestException('Data keluarga wajib diisi');
    if (dto.subsidyId && !user.perms.includes('spp.input')) throw new BadRequestException('Kategori subsidi hanya diatur PJ RTA');
    const run = async (c: PoolClient) => {
      await this.validClass(dto.branchId, dto.classId, c);
      const b = await this.db.one('SELECT spp_standard, registration_fee FROM branches WHERE id = $1', [dto.branchId], c);
      if (!b) throw new BadRequestException('Cabang tidak ditemukan');
      if (await this.db.one('SELECT 1 FROM students WHERE full_name ILIKE $1 AND birth_date = $2', [dto.fullName, dto.birthDate], c))
        throw new BadRequestException('Santri dengan nama dan tanggal lahir yang sama sudah terdaftar');
      const sub = dto.subsidyId ? await this.subsidies.resolve(dto.subsidyId, dto.branchId, { familyId: dto.familyId }, c) : null;
      const familyId = dto.familyId ?? (await this.fam.create(user, dto.family!, c)).id;
      const nis = await this.nextNis(dto.branchId, c);
      const row = await this.db.one(
        `INSERT INTO students(nis, full_name, nickname, gender, birth_place, birth_date, school, family_id, branch_id, class_id, join_date, status, health_notes, spp_rate, registration_note, subsidy_label, subsidy_id, subsidy_since)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, nis`,
        [
          nis,
          dto.fullName,
          dto.nickname ?? null,
          dto.gender,
          dto.birthPlace,
          dto.birthDate,
          dto.school ?? null,
          familyId,
          dto.branchId,
          dto.classId,
          dto.joinDate,
          dto.status,
          dto.healthNotes ?? null,
          sub?.amount ?? b.spp_standard,
          dto.registrationNote || null,
          sub?.name ?? null,
          dto.subsidyId ?? null,
          sub?.since ?? null,
        ],
        c,
      );
      await c.query('INSERT INTO student_placements(student_id, branch_id, class_id, effective_date, note) VALUES ($1,$2,$3,$4,$5)', [row!.id, dto.branchId, dto.classId, dto.joinDate, 'Pendaftaran']);
      await c.query('INSERT INTO status_history(student_id, from_status, to_status, effective_date, actor_id, note) VALUES ($1,NULL,$2,$3,$4,$5)', [
        row!.id,
        dto.status,
        dto.joinDate,
        user.id,
        'Pendaftaran',
      ]);
      // Tagihan pendaftaran dibuat otomatis (prd.md 6.1)
      await c.query(
        `INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount) VALUES ($1,$2,$3,'PENDAFTARAN',$4,'Pendaftaran',$5)
        ON CONFLICT (student_id, type, period) WHERE voided_at IS NULL AND type <> 'BARANG' DO NOTHING`,
        [row!.id, familyId, dto.branchId, dto.joinDate, b.registration_fee],
      );
      await this.audit.log(
        user.id,
        'create',
        'student',
        row!.id,
        null,
        {
          nis: row!.nis,
          fullName: dto.fullName,
          branchId: dto.branchId,
          classId: dto.classId,
          status: dto.status,
          registrationNote: dto.registrationNote,
          subsidyLabel: sub?.name,
          sppRate: sub?.amount,
        },
        c,
      );
      const ikut = sub ? await this.subsidies.pairSiblings(c, row!.id) : []; // saudara Reguler ikut diskon saudara
      await this.subsidies.logChanges(user.id, ikut, c);
      return { id: row!.id as number, nis: row!.nis as string, familyId, saudaraIkut: ikut.length };
    };
    const s = client ? await run(client) : await this.db.tx(run);
    return { id: s.id, nis: s.nis, familyId: s.familyId, saudaraIkut: s.saudaraIkut };
  }

  async update(user: AuthUser, id: number, dto: UpdateStudentDto) {
    const old = await this.db.one(`SELECT ${S_COLS} FROM students s WHERE s.id = $2 AND ${SCOPE}`, [user.branchIds, id]);
    if (!old) throw new NotFoundException('Santri tidak ditemukan');
    if (dto.classId && dto.classId !== old.classId) {
      if (!user.perms.includes('pengajuan.setujui')) throw new BadRequestException('Perubahan kelas hanya oleh PJ RTA (atau lewat mutasi)');
      await this.validClass(old.branchId, dto.classId);
      await this.db.exec('INSERT INTO student_placements(student_id, branch_id, class_id, effective_date, note) VALUES ($1,$2,$3,$4,$5)', [id, old.branchId, dto.classId, today(), 'Kenaikan jenjang']);
    }
    if ((dto.sppRate !== undefined || dto.subsidyId !== undefined) && !user.perms.includes('spp.input')) throw new BadRequestException('Tarif dan subsidi hanya diatur PJ RTA');
    const n = { ...old, ...dto };
    const std = (await this.db.one('SELECT spp_standard FROM branches WHERE id = $1', [old.branchId]))!.spp_standard;
    // subsidi: tarif mengikuti kategori (Pengaturan). Tanpa subsidi: tarif khusus manual, atau kembali ke standar saat subsidi dicabut.
    let rate = dto.sppRate ?? old.sppRate,
      label = old.subsidyLabel,
      subsidyId = old.subsidyId,
      since = old.subsidySince;
    if (dto.subsidyId && dto.subsidyId !== old.subsidyId) {
      const sub = await this.subsidies.resolve(dto.subsidyId, old.branchId, { familyId: old.familyId, studentId: id });
      [rate, label, subsidyId, since] = [sub.amount, sub.name, dto.subsidyId, sub.since];
    } else if (dto.subsidyId === null && (old.subsidyId || old.subsidyLabel)) {
      [rate, label, subsidyId, since] = [dto.sppRate ?? std, null, null, null];
    } else if (subsidyId && dto.sppRate !== undefined && dto.sppRate !== old.sppRate) {
      throw new BadRequestException('Tarif mengikuti kategori subsidi. Ubah tarifnya di menu Pengaturan, atau cabut subsidi untuk memakai tarif khusus.');
    }
    await this.db.exec(
      `UPDATE students SET full_name=$2, nickname=$3, gender=$4, birth_place=$5, birth_date=$6, school=$7, health_notes=$8, class_id=$9, spp_rate=$10, subsidy_label=$11, registration_note=$12, subsidy_id=$13, subsidy_since=$14 WHERE id=$1`,
      [id, n.fullName, n.nickname ?? null, n.gender, n.birthPlace, n.birthDate, n.school ?? null, n.healthNotes ?? null, n.classId, rate, label, n.registrationNote || null, subsidyId, since],
    );
    await this.audit.log(user.id, 'update', 'student', id, old, { ...dto, sppRate: rate, subsidyLabel: label });
    // subsidi berubah: diskon saudara dipasang → saudara Reguler ikut; dicabut/diganti → pasangan yang tinggal sendiri ikut dicabut (aturan 4)
    const { ikut, dicabut } =
      subsidyId !== old.subsidyId
        ? await this.db.tx(async (c) => ({
            ikut: subsidyId ? await this.subsidies.pairSiblings(c, id) : [],
            dicabut: old.subsidyId ? await this.subsidies.reconcileFamily(c, old.familyId) : [],
          }))
        : { ikut: [], dicabut: [] };
    await this.subsidies.logChanges(user.id, [...ikut, ...dicabut]);
    return { ok: true, saudaraIkut: ikut.length, subsidiDicabut: dicabut.length };
  }

  /** Cuti / kembali aktif / mulai belajar: berlaku langsung, tercatat di riwayat */
  async setStatus(user: AuthUser, id: number, dto: StatusDto) {
    const s = await this.db.one(`SELECT s.id, s.status, s.family_id FROM students s WHERE s.id = $2 AND ${SCOPE}`, [user.branchIds, id]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    const allowed: Record<string, [string[], string]> = { CUTI: [['AKTIF'], 'CUTI'], AKTIF: [['CUTI'], 'AKTIF'], MULAI: [['INDENT'], 'AKTIF'] };
    const [from, to] = allowed[dto.action];
    if (!from.includes(s.status)) throw new BadRequestException(`Aksi ${dto.action} tidak berlaku untuk status ${s.status}`);
    if (dto.action === 'CUTI' && !dto.reason) throw new BadRequestException('Alasan cuti wajib diisi');
    const changes = await this.db.tx(async (c) => {
      await c.query('UPDATE students SET status = $2 WHERE id = $1', [id, to]);
      await c.query('INSERT INTO status_history(student_id, from_status, to_status, effective_date, reason, note, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        id,
        s.status,
        to,
        dto.effectiveDate,
        dto.reason ?? null,
        dto.note ?? null,
        user.id,
      ]);
      return this.subsidies.reconcileFamily(c, s.family_id);
    });
    await this.audit.log(user.id, 'status', 'student', id, { status: s.status }, { status: to, ...dto });
    await this.subsidies.logChanges(user.id, changes);
    return { ok: true, status: to, subsidiDicabut: changes.length };
  }

  /** Pengajuan keluar / mutasi: menunggu PJ; santri tetap dihitung Aktif. Hanya satu pengajuan menunggu per santri. */
  async createRequest(user: AuthUser, id: number, dto: RequestDto) {
    const s = await this.db.one(`SELECT s.id, s.status, s.branch_id AS "branchId" FROM students s WHERE s.id = $2 AND ${SCOPE}`, [user.branchIds, id]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    if (s.status === 'KELUAR') throw new BadRequestException('Santri sudah berstatus Keluar');
    if (await this.db.one(`SELECT 1 FROM requests WHERE student_id = $1 AND state = 'MENUNGGU'`, [id])) throw new BadRequestException('Masih ada pengajuan yang menunggu persetujuan PJ');
    if (dto.type === 'MUTASI') {
      if (!dto.targetBranchId || !dto.targetClassId) throw new BadRequestException('Cabang dan kelas tujuan wajib diisi');
      if (dto.targetBranchId === s.branchId) throw new BadRequestException('Mutasi harus ke cabang lain. Untuk pindah kelas di cabang yang sama, hubungi PJ.');
      await this.validClass(dto.targetBranchId, dto.targetClassId);
    }
    const r = await this.db.one(
      `INSERT INTO requests(student_id, type, effective_date, reason, target_branch_id, target_class_id, note, requested_by, from_branch_id, from_class_id)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8, s.branch_id, s.class_id FROM students s WHERE s.id = $1
       RETURNING id, student_id AS "studentId", type, state, effective_date AS "effectiveDate", reason`,
      [id, dto.type, dto.effectiveDate, dto.reason, dto.targetBranchId ?? null, dto.targetClassId ?? null, dto.note ?? null, user.id],
    );
    await this.audit.log(user.id, 'pengajuan', 'student', id, null, dto);
    return r;
  }
}
