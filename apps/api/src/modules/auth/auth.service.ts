import { ForbiddenException, Injectable, UnauthorizedException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { Db } from '../../db/db.module';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { hashPassword, verifyPassword } from '../../common/password';

const WAIT_AFTER = 3,
  WAIT_MIN = 5,
  LOCK_AFTER = 5,
  LOCK_HOURS = 5;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private db: Db,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  /** Login: gagal 3x → tunggu 5 menit; gagal 5x → kunci 5 jam. Pesan error selalu umum. */
  async login(email: string, password: string, meta: { ua?: string; ip?: string } = {}) {
    const u = await this.db.one('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const generic = new UnauthorizedException('Email atau password salah');
    if (!u || !u.is_active) throw generic;
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const menit = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
      const msg = u.failed_attempts >= LOCK_AFTER ? `Akun dikunci sementara selama ${LOCK_HOURS} jam. Hubungi PJ RTA untuk membukanya.` : `Terlalu banyak percobaan. Coba lagi dalam ${menit} menit.`;
      throw new HttpException({ message: msg }, 423);
    }
    if (!(await verifyPassword(password, u.password_hash))) {
      const n = u.failed_attempts + 1;
      const lockedUntil = n >= LOCK_AFTER ? new Date(Date.now() + LOCK_HOURS * 3600_000) : n >= WAIT_AFTER ? new Date(Date.now() + WAIT_MIN * 60_000) : null;
      await this.db.exec('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [u.id, n, lockedUntil]);
      await this.audit.log(u.id, 'login_gagal', 'user', u.id, null, { attempts: n });
      throw generic;
    }
    await this.db.exec('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
    await this.audit.log(u.id, 'login', 'user', u.id);
    const user = await this.buildAuthUser(u.id);
    return { user, accessToken: await this.signAccess(user), refreshToken: await this.issueRefresh(u.id, null, meta) };
  }

  async buildAuthUser(userId: number): Promise<AuthUser> {
    const u = await this.db.one(
      `SELECT u.id, u.name, u.email, r.code AS role, u.must_change_password AS must, u.is_active AS active, r.id AS role_id
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [userId],
    );
    if (!u || !u.active) throw new UnauthorizedException('Akun tidak aktif');
    const perms = (await this.db.many('SELECT perm FROM role_permissions WHERE role_id = $1', [u.role_id])).map((r) => r.perm);
    let branchIds: number[] | null = null;
    // wali tidak punya scope cabang: menu staf yang terlanjur dicentang tetap kosong; data wali lewat /portal (scope keluarga)
    if (u.role === 'WALI') branchIds = [];
    if (u.role === 'USTADZAH') {
      branchIds = (await this.db.many(`SELECT branch_id FROM user_branches WHERE user_id = $1 AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date > CURRENT_DATE)`, [u.id])).map(
        (r) => r.branch_id,
      );
    }
    return { id: u.id, name: u.name, email: u.email, role: u.role, perms, branchIds, mustChangePassword: u.must };
  }

  signAccess(user: AuthUser) {
    return this.jwt.signAsync(user, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.ACCESS_TTL ?? '15m' });
  }

  /** session_id tetap sama sepanjang rotasi token (= satu perangkat/browser). */
  async issueRefresh(userId: number, sessionId: string | null = null, meta: { ua?: string; ip?: string } = {}) {
    const raw = randomBytes(32).toString('hex');
    const days = Number(process.env.REFRESH_TTL_DAYS ?? 14);
    await this.db.exec('INSERT INTO refresh_tokens(user_id, token_hash, expires_at, session_id, user_agent, ip) VALUES ($1,$2,$3,$4,$5,$6)', [
      userId,
      sha(raw),
      new Date(Date.now() + days * 86400_000),
      sessionId ?? randomBytes(8).toString('hex'),
      meta.ua?.slice(0, 300) ?? null,
      meta.ip ?? null,
    ]);
    return raw;
  }
  sessionOf(raw?: string) {
    return raw ? this.db.one('SELECT session_id FROM refresh_tokens WHERE token_hash = $1', [sha(raw)]).then((r) => r?.session_id ?? null) : Promise.resolve(null);
  }

  /** Rotasi refresh token: token lama dicabut, token baru diterbitkan. */
  async refresh(raw?: string, meta: { ua?: string; ip?: string } = {}) {
    if (!raw) throw new UnauthorizedException('Sesi berakhir, silakan masuk lagi');
    const t = await this.db.one('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha(raw)]);
    if (!t || t.revoked || new Date(t.expires_at) < new Date()) throw new UnauthorizedException('Sesi berakhir, silakan masuk lagi');
    await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [t.id]);
    const user = await this.buildAuthUser(t.user_id);
    return { user, accessToken: await this.signAccess(user), refreshToken: await this.issueRefresh(t.user_id, t.session_id, meta) };
  }

  async logout(raw?: string) {
    if (raw) await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1', [sha(raw)]);
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const u = await this.db.one('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!u || !(await verifyPassword(oldPassword, u.password_hash))) throw new ForbiddenException('Password lama salah');
    await this.db.exec('UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1', [
      userId,
      await hashPassword(newPassword),
    ]);
    await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [userId]);
    await this.audit.log(userId, 'ganti_password', 'user', userId);
  }

  // ---------- Profil ----------
  async profile(userId: number) {
    const u = await this.db.one(
      `SELECT u.id, u.name, u.email, u.phone, u.prefs, u.created_at AS "createdAt", u.password_changed_at AS "passwordChangedAt", r.code AS role, r.name AS "roleName"
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [userId],
    );
    const branches = await this.db.many(
      `SELECT b.name, ub.start_date AS "startDate", ub.end_date AS "endDate" FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
       WHERE ub.user_id = $1 AND (ub.end_date IS NULL OR ub.end_date >= CURRENT_DATE) ORDER BY ub.start_date`,
      [userId],
    );
    const n = await this.db.one(
      `SELECT COUNT(*)::int AS n FROM students s WHERE s.status = 'AKTIF' AND s.branch_id IN (SELECT branch_id FROM user_branches WHERE user_id = $1 AND (end_date IS NULL OR end_date >= CURRENT_DATE))`,
      [userId],
    );
    return { ...u, branches, santriDiampu: n?.n ?? 0 };
  }
  async updateProfile(userId: number, dto: { name?: string; phone?: string }) {
    const old = await this.db.one('SELECT name, phone FROM users WHERE id = $1', [userId]);
    await this.db.exec('UPDATE users SET name = COALESCE($2, name), phone = COALESCE($3, phone) WHERE id = $1', [userId, dto.name ?? null, dto.phone ?? null]);
    await this.audit.log(userId, 'update', 'profil', userId, old, dto);
    return { ok: true };
  }
  async updatePrefs(userId: number, prefs: Record<string, unknown>) {
    const allowed = ['notifHafalan', 'notifBukti', 'notifPengajuan', 'textSize'];
    const clean = Object.fromEntries(Object.entries(prefs).filter(([k]) => allowed.includes(k)));
    await this.db.exec('UPDATE users SET prefs = prefs || $2::jsonb WHERE id = $1', [userId, JSON.stringify(clean)]);
    return { ok: true };
  }
  /** Perangkat yang sedang masuk = session_id dengan token yang masih berlaku */
  async sessions(userId: number, currentRaw?: string) {
    const current = await this.sessionOf(currentRaw);
    const rows = await this.db.many(
      `SELECT DISTINCT ON (session_id) session_id AS id, user_agent AS "userAgent", ip, created_at AS "lastActive"
       FROM refresh_tokens WHERE user_id = $1 AND revoked = false AND expires_at > now() AND session_id IS NOT NULL
       ORDER BY session_id, created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ ...r, current: r.id === current })).sort((a, b) => Number(b.current) - Number(a.current));
  }
  async revokeSession(userId: number, sessionId: string) {
    await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND session_id = $2', [userId, sessionId]);
    await this.audit.log(userId, 'keluarkan_perangkat', 'user', userId, null, { sessionId });
    return { ok: true };
  }
  async logoutAll(userId: number) {
    await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [userId]);
    await this.audit.log(userId, 'keluar_semua', 'user', userId);
    return { ok: true };
  }
}
