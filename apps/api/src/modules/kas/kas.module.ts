import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { PoolClient } from 'pg';
import { printedBy, rp, sendPdf, sendXlsx } from '../../common/report';
import type { Sheet } from '../../common/report';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { StorageService, sniffImage } from '../../common/storage.service';
import { addMonths, monthLabel, monthStart, rupiah, todayWIB } from '../../common/time';
import { BillingModule, BillingService } from '../billing/billing.module';

const MAX_PROOF = 5 * 1024 * 1024;
const MAX_AMOUNT = 100_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ITEM_ICONS = ['BOOK', 'SHIRT', 'STAR', 'BOX'] as const;

class ItemCategoryDto {
  @IsOptional() @IsString() @Length(2, 40, { message: 'Nama kategori 2–40 karakter' }) name?: string;
  @IsOptional() @IsIn(ITEM_ICONS as unknown as string[]) icon?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ItemDto {
  @IsOptional() @IsInt() categoryId?: number;
  @IsOptional() @IsString() @Length(2, 60, { message: 'Nama barang 2–60 karakter' }) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) price?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) lowStock?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class StockDto {
  @IsInt() branchId: number;
  @IsInt() @Min(-9999) @Max(9999) delta: number;
  @IsString() @Length(3, 200, { message: 'Keterangan stok minimal 3 karakter' }) note: string;
}
class ExpenseCategoryDto {
  @IsOptional() @IsString() @Length(2, 40, { message: 'Nama kategori 2–40 karakter' }) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ReasonDto { @IsOptional() @IsString() reason?: string; }

type Line = { itemId: number; qty: number };
/** Baris barang dari form (JSON string di multipart): digabung per barang, qty 1–999 */
function parseLines(raw: any, required: boolean): Line[] {
  let arr: any[] = [];
  try { arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw ?? []; } catch { throw new BadRequestException('Daftar barang tidak valid'); }
  if (!Array.isArray(arr)) throw new BadRequestException('Daftar barang tidak valid');
  const m = new Map<number, number>();
  for (const x of arr) {
    const id = Number(x?.itemId), q = Number(x?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1 || q > 999) throw new BadRequestException('Jumlah barang harus 1–999');
    m.set(id, (m.get(id) ?? 0) + q);
  }
  if (required && !m.size) throw new BadRequestException('Pilih minimal satu barang');
  return [...m].map(([itemId, qty]) => ({ itemId, qty }));
}
const dup = (e: any, msg: string) => { if (e?.code === '23505') throw new BadRequestException(msg); throw e; };

@Injectable()
export class KasService {
  constructor(private db: Db, private audit: AuditService, private storage: StorageService, private billing: BillingService) {}

  private ids(user: AuthUser, branchId?: number) {
    if (user.branchIds) return branchId ? user.branchIds.filter((b) => b === Number(branchId)) : user.branchIds;
    return branchId ? [Number(branchId)] : null;
  }
  private month(m?: string) {
    if (m && !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('Format bulan harus YYYY-MM');
    const from = m ? `${m}-01` : monthStart();
    return { from, to: addMonths(from, 1) };
  }
  private date(v: any, label: string) {
    const d = String(v ?? '') || todayWIB();
    if (!DATE.test(d) || isNaN(Date.parse(d))) throw new BadRequestException(`${label} tidak valid`);
    if (d > todayWIB()) throw new BadRequestException(`${label} tidak boleh di masa depan`);
    return d;
  }
  private async saveProof(file?: Express.Multer.File) { return file ? this.billing.saveProof(file) : null; }

  // ---------------- Ringkasan kas (bulan) ----------------
  // Pembukuan terpisah: Kas = penjualan barang (tunai/transfer + tagihan barang yang sudah dibayar) − pengeluaran disetujui.
  // Uang SPP & daftar ulang dibukukan di menu SPP, uang pendaftaran di menu Pendaftaran.

  /** Pembayaran terverifikasi atas tagihan barang (jual "Tagihkan ke wali") dalam rentang [from, to) */
  private paidBarang(from: string, to: string, ids: number[] | null) {
    return this.db.many(
      `SELECT p.paid_at AS date, p.method, a.amount::int AS amount, s.id AS "saleId", st.full_name AS "fullName", b.name AS "branchName",
         (SELECT string_agg(si.name || ' ×' || si.qty, ', ' ORDER BY si.name) FROM sale_items si WHERE si.sale_id = s.id) AS items
       FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id JOIN sales s ON s.invoice_id = i.id
       JOIN students st ON st.id = s.student_id JOIN branches b ON b.id = i.branch_id
       WHERE p.state = 'TERVERIFIKASI' AND i.type = 'BARANG' AND p.paid_at >= $1 AND p.paid_at < $2 AND ($3::int[] IS NULL OR i.branch_id = ANY($3))
       ORDER BY p.paid_at DESC`, [from, to, ids]);
  }

  /** Total masuk/keluar per bulan dalam rentang [from, to) */
  private async monthly(from: string, to: string, ids: number[] | null) {
    const [pay, sale, exp] = await Promise.all([
      this.db.many(`SELECT to_char(p.paid_at, 'YYYY-MM') AS m, SUM(a.amount)::int AS v FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id
        WHERE p.state = 'TERVERIFIKASI' AND i.type = 'BARANG' AND p.paid_at >= $1 AND p.paid_at < $2 AND ($3::int[] IS NULL OR i.branch_id = ANY($3)) GROUP BY 1`, [from, to, ids]),
      this.db.many(`SELECT to_char(sold_at, 'YYYY-MM') AS m, SUM(total)::int AS v FROM sales
        WHERE canceled_at IS NULL AND method <> 'TAGIHAN' AND sold_at >= $1 AND sold_at < $2 AND ($3::int[] IS NULL OR branch_id = ANY($3)) GROUP BY 1`, [from, to, ids]),
      this.db.many(`SELECT to_char(spent_at, 'YYYY-MM') AS m, SUM(amount)::int AS v FROM expenses
        WHERE state = 'DISETUJUI' AND spent_at >= $1 AND spent_at < $2 AND ($3::int[] IS NULL OR branch_id = ANY($3)) GROUP BY 1`, [from, to, ids]),
    ]);
    const v = (rows: any[], m: string) => rows.find((r) => r.m === m)?.v ?? 0;
    const out: { month: string; label: string; masuk: number; keluar: number }[] = [];
    for (let m = from; m < to; m = addMonths(m, 1)) {
      const k = m.slice(0, 7);
      out.push({ month: k, label: monthLabel(m).split(' ')[0].slice(0, 3), masuk: v(pay, k) + v(sale, k), keluar: v(exp, k) });
    }
    return out;
  }

  async overview(user: AuthUser, month?: string, branchId?: number) {
    const { from, to } = this.month(month);
    const ids = this.ids(user, branchId);
    const [paid, sales, expenses] = await Promise.all([
      this.paidBarang(from, to, ids),
      this.saleRows(`s.sold_at >= $1 AND s.sold_at < $2 AND ($3::int[] IS NULL OR s.branch_id = ANY($3))`, [from, to, ids]),
      this.db.many(
        `SELECT e.id, e.spent_at AS date, e.amount, e.description, e.method, e.state, e.reason, (e.proof_path IS NOT NULL) AS "hasProof",
           c.name AS category, b.name AS "branchName", u.name AS "createdBy", d.name AS "decidedBy",
           (SELECT string_agg(i.name || ' +' || x.qty, ', ' ORDER BY i.name) FROM expense_items x JOIN items i ON i.id = x.item_id WHERE x.expense_id = e.id) AS restock
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN branches b ON b.id = e.branch_id
         LEFT JOIN users u ON u.id = e.created_by LEFT JOIN users d ON d.id = e.decided_by
         WHERE ((e.spent_at >= $1 AND e.spent_at < $2) OR e.state = 'MENUNGGU') AND ($3::int[] IS NULL OR e.branch_id = ANY($3))
         ORDER BY e.spent_at DESC, e.id DESC`, [from, to, ids]),
    ]);
    const direct = sales.filter((s) => !s.canceled && s.method !== 'TAGIHAN');
    const approved = expenses.filter((e) => e.state === 'DISETUJUI' && e.date >= from && e.date < to);
    const masuk = direct.reduce((a, s) => a + s.total, 0) + paid.reduce((a, p) => a + p.amount, 0);
    const keluar = approved.reduce((a, e) => a + e.amount, 0);

    // per kategori: pemasukan per kategori barang (rincian penjualan yang dihitung bulan ini) & pengeluaran per kategori
    const counted = [...direct.map((s) => s.id), ...paid.map((p) => p.saleId)];
    const lines = counted.length ? await this.db.many(
      `SELECT si.sale_id, ic.name AS category, SUM(si.price * si.qty)::int AS amount FROM sale_items si JOIN items it ON it.id = si.item_id JOIN item_categories ic ON ic.id = it.category_id
       WHERE si.sale_id = ANY($1) GROUP BY 1, 2`, [counted]) : [];
    const inc = new Map<string, number>();
    for (const id of counted) for (const l of lines.filter((x) => x.sale_id === id)) inc.set(l.category, (inc.get(l.category) ?? 0) + l.amount);
    const out = new Map<string, number>();
    for (const e of approved) out.set(e.category, (out.get(e.category) ?? 0) + e.amount);
    const sorted = (m: Map<string, number>) => [...m].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);

    // tagihan barang yang belum dibayar (semua bulan)
    const { sql } = this.billing.invoicesSql(`WHERE type = 'BARANG' AND status IN ('BELUM','TUNGGAKAN','MENUNGGU') AND ($1::int[] IS NULL OR branch_id = ANY($1)) ORDER BY period, id`);
    const open = await this.db.many(sql, [ids]);
    const kids = open.length ? await this.db.many('SELECT id, full_name FROM students WHERE id = ANY($1)', [open.map((i) => i.student_id)]) : [];
    const unpaid = open.map((i) => ({ invoiceId: i.id, studentId: i.student_id, familyId: i.family_id, fullName: kids.find((k) => k.id === i.student_id)?.full_name ?? '-',
      label: i.label.replace(/^Pembelian: /, ''), amount: i.amount - i.paid_ok, status: i.status, date: i.period }));

    const transactions = [
      ...paid.map((p) => ({ key: `p-${p.saleId}-${p.date}`, kind: 'MASUK', source: 'BAYAR', saleId: p.saleId, date: p.date, auto: true, category: 'Pelunasan tagihan barang',
        title: p.items, sub: `${p.fullName} · ${p.branchName}`, method: p.method === 'TUNAI' ? 'Tunai' : 'Transfer', amount: p.amount, counted: true })),
      ...sales.map((s) => ({ key: `s-${s.id}`, kind: 'JUAL', source: 'JUAL', ...s, auto: false, category: 'Penjualan barang', title: s.items, sub: `${s.fullName} · ${s.branchName}`, amount: s.total,
        counted: !s.canceled && s.method !== 'TAGIHAN' })),
      ...expenses.map((e) => ({ key: `e-${e.id}`, kind: 'KELUAR', source: 'KELUAR', ...e, auto: false, title: e.description, sub: e.branchName, counted: e.state === 'DISETUJUI' })),
    ].sort((a: any, b: any) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const chart = await this.monthly(addMonths(from, -5), to, ids);
    const pending = expenses.filter((e) => e.state === 'MENUNGGU');
    return {
      month: from.slice(0, 7), label: monthLabel(from),
      summary: { masuk, keluar, selisih: masuk - keluar, penjualan: masuk,
        belumDibayar: unpaid.reduce((a, u) => a + u.amount, 0), menunggu: pending.length, menungguNominal: pending.reduce((a, e) => a + e.amount, 0) },
      chart, categories: { masuk: sorted(inc), keluar: sorted(out) }, unpaid, transactions,
    };
  }

  /** Penjualan + ringkasan barang + status tagihan (untuk cara bayar TAGIHAN) */
  private async saleRows(where: string, params: any[]) {
    const rows = await this.db.many(
      `SELECT s.id, s.sold_at AS date, s.method, s.total, s.invoice_id AS "invoiceId", (s.canceled_at IS NOT NULL) AS canceled, s.cancel_reason AS "cancelReason",
         (s.proof_path IS NOT NULL) AS "hasProof", s.student_id AS "studentId", s.family_id AS "familyId", st.full_name AS "fullName", b.name AS "branchName", u.name AS "createdBy",
         (SELECT string_agg(si.name || ' ×' || si.qty, ', ' ORDER BY si.name) FROM sale_items si WHERE si.sale_id = s.id) AS items
       FROM sales s JOIN students st ON st.id = s.student_id JOIN branches b ON b.id = s.branch_id LEFT JOIN users u ON u.id = s.created_by
       WHERE ${where} ORDER BY s.sold_at DESC, s.id DESC`, params);
    const invIds = rows.filter((r) => r.invoiceId).map((r) => r.invoiceId);
    const inv = invIds.length ? await this.db.many(this.billing.invoicesSql('WHERE id = ANY($1)').sql, [invIds]) : []; // tagihan dari penjualan batal sudah di-void → status null
    return rows.map((r) => ({ ...r, invoiceStatus: r.invoiceId ? (inv.find((i) => i.id === r.invoiceId)?.status ?? null) : null }));
  }

  // ---------------- Katalog ----------------
  async catalog(user: AuthUser, branchId?: number) {
    const ids = this.ids(user, branchId);
    const [cats, items, stock, ecats, branches] = await Promise.all([
      this.db.many(`SELECT id, name, icon, is_active AS "isActive" FROM item_categories ORDER BY is_active DESC, id`),
      this.db.many(`SELECT id, category_id AS "categoryId", name, price, low_stock AS "lowStock", is_active AS "isActive" FROM items ORDER BY is_active DESC, name`),
      this.db.many(`SELECT item_id, branch_id, SUM(delta)::int AS qty FROM stock_moves WHERE ($1::int[] IS NULL OR branch_id = ANY($1)) GROUP BY item_id, branch_id`, [ids]),
      this.db.many(`SELECT e.id, e.name, e.is_active AS "isActive", (SELECT COUNT(*) FROM expenses x WHERE x.category_id = e.id)::int AS used FROM expense_categories e ORDER BY e.is_active DESC, e.id`),
      this.db.many(`SELECT id, name FROM branches WHERE is_active AND ($1::int[] IS NULL OR id = ANY($1)) ORDER BY id`, [ids]),
    ]);
    return {
      branches,
      itemCategories: cats.map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id).map((i) => {
        const stocks = branches.map((b) => ({ branchId: b.id, branchName: b.name, qty: stock.find((s) => s.item_id === i.id && s.branch_id === b.id)?.qty ?? 0 }));
        return { ...i, stock: stocks.reduce((a, s) => a + s.qty, 0), stocks };
      }) })),
      expenseCategories: ecats,
      icons: ITEM_ICONS,
    };
  }

  async createItemCategory(user: AuthUser, dto: ItemCategoryDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Nama kategori wajib diisi');
    const r = await this.db.one(`INSERT INTO item_categories(name, icon) VALUES ($1, $2) RETURNING id`, [dto.name.trim(), dto.icon ?? 'BOX']).catch((e) => dup(e, 'Nama kategori sudah ada'));
    await this.audit.log(user.id, 'create', 'item_category', r.id, null, { name: dto.name.trim(), icon: dto.icon ?? 'BOX' });
    return r;
  }
  async updateItemCategory(user: AuthUser, id: number, dto: ItemCategoryDto) {
    const old = await this.db.one('SELECT id, name, icon, is_active FROM item_categories WHERE id = $1', [id]);
    if (!old) throw new NotFoundException('Kategori tidak ditemukan');
    const next = { name: dto.name?.trim() ?? old.name, icon: dto.icon ?? old.icon, isActive: dto.isActive ?? old.is_active };
    await this.db.exec('UPDATE item_categories SET name = $2, icon = $3, is_active = $4 WHERE id = $1', [id, next.name, next.icon, next.isActive]).catch((e) => dup(e, 'Nama kategori sudah ada'));
    await this.audit.log(user.id, 'update', 'item_category', id, { name: old.name, icon: old.icon, isActive: old.is_active }, next);
    return { ok: true };
  }
  async createItem(user: AuthUser, dto: ItemDto) {
    if (!dto.categoryId || !dto.name?.trim() || dto.price == null) throw new BadRequestException('Kategori, nama, dan harga barang wajib diisi');
    const c = await this.db.one('SELECT id, is_active FROM item_categories WHERE id = $1', [dto.categoryId]);
    if (!c || !c.is_active) throw new BadRequestException('Kategori tidak ditemukan atau nonaktif');
    const r = await this.db.one(`INSERT INTO items(category_id, name, price, low_stock) VALUES ($1,$2,$3,$4) RETURNING id`, [dto.categoryId, dto.name.trim(), dto.price, dto.lowStock ?? 3])
      .catch((e) => dup(e, 'Nama barang sudah ada'));
    await this.audit.log(user.id, 'create', 'item', r.id, null, { categoryId: dto.categoryId, name: dto.name.trim(), price: dto.price, lowStock: dto.lowStock ?? 3 });
    return r;
  }
  /** Harga baru hanya untuk penjualan berikutnya; penjualan lama menyimpan harga saat jual. */
  async updateItem(user: AuthUser, id: number, dto: ItemDto) {
    const old = await this.db.one('SELECT id, category_id, name, price, low_stock, is_active FROM items WHERE id = $1', [id]);
    if (!old) throw new NotFoundException('Barang tidak ditemukan');
    if (dto.categoryId && dto.categoryId !== old.category_id && !(await this.db.one('SELECT 1 FROM item_categories WHERE id = $1 AND is_active', [dto.categoryId])))
      throw new BadRequestException('Kategori tidak ditemukan atau nonaktif');
    const next = { categoryId: dto.categoryId ?? old.category_id, name: dto.name?.trim() ?? old.name, price: dto.price ?? old.price, lowStock: dto.lowStock ?? old.low_stock, isActive: dto.isActive ?? old.is_active };
    await this.db.exec('UPDATE items SET category_id = $2, name = $3, price = $4, low_stock = $5, is_active = $6 WHERE id = $1', [id, next.categoryId, next.name, next.price, next.lowStock, next.isActive])
      .catch((e) => dup(e, 'Nama barang sudah ada'));
    await this.audit.log(user.id, 'update', 'item', id, { categoryId: old.category_id, name: old.name, price: old.price, lowStock: old.low_stock, isActive: old.is_active }, next);
    return { ok: true };
  }
  /** Stok awal / koreksi (PJ). Stok tidak boleh minus. */
  async adjustStock(user: AuthUser, itemId: number, dto: StockDto) {
    if (!dto.delta) throw new BadRequestException('Jumlah perubahan stok tidak boleh 0');
    const ids = this.ids(user);
    if (ids && !ids.includes(dto.branchId)) throw new NotFoundException('Cabang tidak ditemukan');
    const item = await this.db.one('SELECT id, name FROM items WHERE id = $1', [itemId]);
    if (!item) throw new NotFoundException('Barang tidak ditemukan');
    const qty = await this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', ['stok', dto.branchId]);
      const cur = (await c.query('SELECT COALESCE(SUM(delta), 0)::int AS q FROM stock_moves WHERE item_id = $1 AND branch_id = $2', [itemId, dto.branchId])).rows[0].q;
      if (cur + dto.delta < 0) throw new BadRequestException(`Stok ${item.name} hanya ${cur}, tidak bisa dikurangi ${-dto.delta}`);
      await c.query(`INSERT INTO stock_moves(item_id, branch_id, delta, kind, note, created_by) VALUES ($1,$2,$3,'KOREKSI',$4,$5)`, [itemId, dto.branchId, dto.delta, dto.note.trim(), user.id]);
      await this.audit.log(user.id, 'koreksi_stok', 'item', itemId, { branchId: dto.branchId, qty: cur }, { branchId: dto.branchId, qty: cur + dto.delta, note: dto.note.trim() }, c);
      return cur + dto.delta;
    });
    return { ok: true, qty };
  }
  async stockHistory(user: AuthUser, itemId: number) {
    return this.db.many(
      `SELECT m.id, m.delta, m.kind, m.note, m.created_at AS "createdAt", b.name AS "branchName", u.name AS "by", m.sale_id AS "saleId", m.expense_id AS "expenseId"
       FROM stock_moves m JOIN branches b ON b.id = m.branch_id LEFT JOIN users u ON u.id = m.created_by
       WHERE m.item_id = $1 AND ($2::int[] IS NULL OR m.branch_id = ANY($2)) ORDER BY m.created_at DESC, m.id DESC LIMIT 50`, [itemId, this.ids(user)]);
  }

  async createExpenseCategory(user: AuthUser, dto: ExpenseCategoryDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Nama kategori wajib diisi');
    const r = await this.db.one('INSERT INTO expense_categories(name) VALUES ($1) RETURNING id', [dto.name.trim()]).catch((e) => dup(e, 'Nama kategori sudah ada'));
    await this.audit.log(user.id, 'create', 'expense_category', r.id, null, { name: dto.name.trim() });
    return r;
  }
  async updateExpenseCategory(user: AuthUser, id: number, dto: ExpenseCategoryDto) {
    const old = await this.db.one('SELECT id, name, is_active FROM expense_categories WHERE id = $1', [id]);
    if (!old) throw new NotFoundException('Kategori tidak ditemukan');
    const next = { name: dto.name?.trim() ?? old.name, isActive: dto.isActive ?? old.is_active };
    await this.db.exec('UPDATE expense_categories SET name = $2, is_active = $3 WHERE id = $1', [id, next.name, next.isActive]).catch((e) => dup(e, 'Nama kategori sudah ada'));
    await this.audit.log(user.id, 'update', 'expense_category', id, { name: old.name, isActive: old.is_active }, next);
    return { ok: true };
  }

  // ---------------- Penjualan ----------------
  async students(user: AuthUser, q?: string) {
    return this.db.many(
      `SELECT s.id, s.full_name AS "fullName", s.nickname, s.family_id AS "familyId", c.name AS "className", b.id AS "branchId", b.name AS "branchName", f.father_name AS "familyName"
       FROM students s JOIN classes c ON c.id = s.class_id JOIN branches b ON b.id = s.branch_id JOIN families f ON f.id = s.family_id
       WHERE s.status <> 'KELUAR' AND ($1::int[] IS NULL OR s.branch_id = ANY($1)) AND ($2::text IS NULL OR s.full_name ILIKE $2 OR s.nickname ILIKE $2 OR f.father_name ILIKE $2)
       ORDER BY s.full_name LIMIT 20`, [user.branchIds, q?.trim() ? `%${q.trim()}%` : null]);
  }

  /** Stok berkurang di cabang santri. TAGIHAN → tagihan BARANG (masuk menu Bayar, pesan WA, halaman wali). TRANSFER wajib bukti. */
  async createSale(user: AuthUser, body: any, file?: Express.Multer.File) {
    const studentId = Number(body.studentId);
    const method = String(body.method ?? '');
    if (!['TUNAI', 'TRANSFER', 'TAGIHAN'].includes(method)) throw new BadRequestException('Pilih cara bayar');
    const lines = parseLines(body.items, true);
    const soldAt = this.date(body.soldAt, 'Tanggal jual');
    const s = await this.db.one(`SELECT id, family_id, branch_id, full_name, status FROM students WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))`, [studentId, user.branchIds]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    if (s.status === 'KELUAR') throw new BadRequestException('Santri sudah keluar');
    if (method === 'TRANSFER' && !file) throw new BadRequestException('Bukti transfer wajib diunggah');
    const proof = method === 'TRANSFER' ? await this.saveProof(file) : null;
    const res = await this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', ['stok', s.branch_id]);
      const items = (await c.query('SELECT id, name, price, is_active FROM items WHERE id = ANY($1)', [lines.map((l) => l.itemId)])).rows;
      const stock = (await c.query('SELECT item_id, SUM(delta)::int AS q FROM stock_moves WHERE branch_id = $1 AND item_id = ANY($2) GROUP BY item_id', [s.branch_id, lines.map((l) => l.itemId)])).rows;
      const rows = lines.map((l) => {
        const it = items.find((i) => i.id === l.itemId);
        if (!it || !it.is_active) throw new BadRequestException('Ada barang yang tidak ditemukan atau nonaktif');
        const have = stock.find((x) => x.item_id === l.itemId)?.q ?? 0;
        if (have < l.qty) throw new BadRequestException(`Stok ${it.name} di cabang ini tinggal ${have}`);
        return { ...l, name: it.name, price: it.price };
      });
      const total = rows.reduce((a, r) => a + r.price * r.qty, 0);
      const summary = rows.map((r) => `${r.name} ×${r.qty}`).join(', ');
      let invoiceId: number | null = null;
      if (method === 'TAGIHAN') {
        if (total <= 0) throw new BadRequestException('Total Rp0 tidak bisa ditagihkan');
        const label = `Pembelian: ${summary}`.slice(0, 120);
        invoiceId = (await c.query(`INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount) VALUES ($1,$2,$3,'BARANG',$4,$5,$6) RETURNING id`,
          [s.id, s.family_id, s.branch_id, soldAt, label, total])).rows[0].id;
      }
      const sale = (await c.query(`INSERT INTO sales(student_id, family_id, branch_id, sold_at, method, total, proof_path, invoice_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [s.id, s.family_id, s.branch_id, soldAt, method, total, proof, invoiceId, user.id])).rows[0];
      for (const r of rows) {
        await c.query('INSERT INTO sale_items(sale_id, item_id, name, price, qty) VALUES ($1,$2,$3,$4,$5)', [sale.id, r.itemId, r.name, r.price, r.qty]);
        await c.query(`INSERT INTO stock_moves(item_id, branch_id, delta, kind, sale_id, created_by) VALUES ($1,$2,$3,'JUAL',$4,$5)`, [r.itemId, s.branch_id, -r.qty, sale.id, user.id]);
      }
      await this.audit.log(user.id, 'jual_barang', 'sale', sale.id, null, { studentId: s.id, method, total, items: rows.map((r) => ({ itemId: r.itemId, qty: r.qty, price: r.price })), invoiceId }, c);
      return { id: sale.id, total, invoiceId };
    });
    return res;
  }

  /** Batal (PJ): stok kembali; tagihan barang di-void bila belum ada pembayaran. Tidak dihapus. */
  async cancelSale(user: AuthUser, id: number, reason?: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Alasan wajib diisi');
    const s = await this.db.one('SELECT * FROM sales WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [id, user.branchIds]);
    if (!s) throw new NotFoundException('Penjualan tidak ditemukan');
    if (s.canceled_at) throw new BadRequestException('Penjualan sudah dibatalkan');
    if (s.invoice_id) {
      const { sql } = this.billing.invoicesSql('WHERE id = $1');
      const inv = await this.db.one(sql, [s.invoice_id]);
      if (inv && (inv.paid_ok > 0 || inv.paid_pending > 0)) throw new BadRequestException('Tagihan barang ini sudah dibayar atau sedang diverifikasi. Batalkan pembayarannya dulu di menu Bayar.');
    }
    await this.db.tx(async (c) => {
      const items = (await c.query('SELECT item_id, qty FROM sale_items WHERE sale_id = $1', [id])).rows;
      for (const i of items) await c.query(`INSERT INTO stock_moves(item_id, branch_id, delta, kind, sale_id, note, created_by) VALUES ($1,$2,$3,'BATAL_JUAL',$4,$5,$6)`, [i.item_id, s.branch_id, i.qty, id, reason.trim(), user.id]);
      if (s.invoice_id) await c.query(`UPDATE invoices SET voided_at = now(), void_reason = $2 WHERE id = $1 AND voided_at IS NULL`, [s.invoice_id, `Penjualan barang dibatalkan: ${reason.trim()}`]);
      await c.query('UPDATE sales SET canceled_at = now(), cancel_reason = $2, canceled_by = $3 WHERE id = $1', [id, reason.trim(), user.id]);
      await this.audit.log(user.id, 'batal_jual', 'sale', id, { canceled: false }, { canceled: true, reason: reason.trim() }, c);
    });
    return { ok: true };
  }

  /** Tab Pembelian di detail santri */
  async studentSales(user: AuthUser, studentId: number) {
    const st = await this.db.one('SELECT id FROM students WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [studentId, user.branchIds]);
    if (!st) throw new NotFoundException('Santri tidak ditemukan');
    const rows = await this.saleRows('s.student_id = $1', [studentId]);
    const year = todayWIB().slice(0, 4);
    const active = rows.filter((r) => !r.canceled);
    return {
      rows,
      totalYear: active.filter((r) => String(r.date).startsWith(year)).reduce((a, r) => a + r.total, 0),
      unpaid: active.filter((r) => r.method === 'TAGIHAN' && r.invoiceStatus !== 'LUNAS').length,
    };
  }

  // ---------------- Pengeluaran ----------------
  /** Pengeluaran dari pengguna tanpa kas.setujui (ustadzah) menunggu persetujuan PJ. Restock menambah stok saat disetujui. */
  async createExpense(user: AuthUser, body: any, file?: Express.Multer.File) {
    const ids = this.ids(user);
    const branchId = Number(body.branchId) || (ids?.length === 1 ? ids[0] : 0);
    if (!branchId) throw new BadRequestException('Pilih cabang');
    if (ids && !ids.includes(branchId)) throw new NotFoundException('Cabang tidak ditemukan');
    const amount = Number(body.amount), categoryId = Number(body.categoryId);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) throw new BadRequestException('Nominal tidak valid');
    const description = String(body.description ?? '').trim();
    if (description.length < 3 || description.length > 200) throw new BadRequestException('Keterangan 3–200 karakter');
    const method = body.method === 'TRANSFER' ? 'TRANSFER' : 'TUNAI';
    const spentAt = this.date(body.spentAt, 'Tanggal');
    const lines = parseLines(body.restock, false);
    if (!(await this.db.one('SELECT 1 FROM expense_categories WHERE id = $1 AND is_active', [categoryId]))) throw new BadRequestException('Pilih kategori pengeluaran');
    if (!(await this.db.one('SELECT 1 FROM branches WHERE id = $1 AND is_active', [branchId]))) throw new NotFoundException('Cabang tidak ditemukan');
    if (lines.length) {
      const ok = await this.db.many('SELECT id FROM items WHERE id = ANY($1) AND is_active', [lines.map((l) => l.itemId)]);
      if (ok.length !== lines.length) throw new BadRequestException('Ada barang restock yang tidak ditemukan atau nonaktif');
    }
    if (file && !sniffImage(file.buffer)) throw new BadRequestException('Format nota harus JPG, PNG, WebP, atau PDF');
    const proof = await this.saveProof(file);
    const direct = user.perms.includes('kas.setujui');
    const r = await this.db.tx(async (c) => {
      const e = (await c.query(`INSERT INTO expenses(branch_id, category_id, amount, description, spent_at, method, proof_path, state, decided_by, decided_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, state`,
        [branchId, categoryId, amount, description, spentAt, method, proof, direct ? 'DISETUJUI' : 'MENUNGGU', direct ? user.id : null, direct ? new Date() : null, user.id])).rows[0];
      for (const l of lines) await c.query('INSERT INTO expense_items(expense_id, item_id, qty) VALUES ($1,$2,$3)', [e.id, l.itemId, l.qty]);
      if (direct) await this.restock(c, e.id, branchId, user.id, 1);
      await this.audit.log(user.id, 'catat_pengeluaran', 'expense', e.id, null, { branchId, categoryId, amount, method, state: e.state, restock: lines }, c);
      return e;
    });
    return r;
  }
  private async restock(c: PoolClient, expenseId: number, branchId: number, actor: number, sign: 1 | -1) {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', ['stok', branchId]);
    const lines = (await c.query('SELECT x.item_id, x.qty, i.name FROM expense_items x JOIN items i ON i.id = x.item_id WHERE x.expense_id = $1', [expenseId])).rows;
    for (const l of lines) {
      if (sign < 0) {
        const cur = (await c.query('SELECT COALESCE(SUM(delta), 0)::int AS q FROM stock_moves WHERE item_id = $1 AND branch_id = $2', [l.item_id, branchId])).rows[0].q;
        if (cur < l.qty) throw new BadRequestException(`Stok ${l.name} dari restock ini sudah terjual (sisa ${cur}). Koreksi stok dulu di Katalog.`);
      }
      await c.query(`INSERT INTO stock_moves(item_id, branch_id, delta, kind, expense_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [l.item_id, branchId, sign * l.qty, sign > 0 ? 'RESTOCK' : 'BATAL_RESTOCK', expenseId, actor]);
    }
  }
  private async scopedExpense(user: AuthUser, id: number) {
    const e = await this.db.one('SELECT * FROM expenses WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [id, user.branchIds]);
    if (!e) throw new NotFoundException('Pengeluaran tidak ditemukan');
    return e;
  }
  async approveExpense(user: AuthUser, id: number) {
    const e = await this.scopedExpense(user, id);
    if (e.state !== 'MENUNGGU') throw new BadRequestException('Pengeluaran ini tidak sedang menunggu persetujuan');
    await this.db.tx(async (c) => {
      await c.query(`UPDATE expenses SET state = 'DISETUJUI', decided_by = $2, decided_at = now() WHERE id = $1`, [id, user.id]);
      await this.restock(c, id, e.branch_id, user.id, 1);
      await this.audit.log(user.id, 'setujui_pengeluaran', 'expense', id, { state: 'MENUNGGU' }, { state: 'DISETUJUI' }, c);
    });
    return { ok: true };
  }
  /** Tolak (menunggu) atau batalkan (disetujui, stok restock ditarik kembali). Alasan wajib, tidak dihapus. */
  async decline(user: AuthUser, id: number, reason?: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Alasan wajib diisi');
    const e = await this.scopedExpense(user, id);
    if (!['MENUNGGU', 'DISETUJUI'].includes(e.state)) throw new BadRequestException('Pengeluaran sudah ditolak atau dibatalkan');
    const next = e.state === 'MENUNGGU' ? 'DITOLAK' : 'DIBATALKAN';
    await this.db.tx(async (c) => {
      if (e.state === 'DISETUJUI') await this.restock(c, id, e.branch_id, user.id, -1);
      await c.query('UPDATE expenses SET state = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1', [id, next, reason.trim(), user.id]);
      await this.audit.log(user.id, next === 'DITOLAK' ? 'tolak_pengeluaran' : 'batal_pengeluaran', 'expense', id, { state: e.state }, { state: next, reason: reason.trim() }, c);
    });
    return { ok: true, state: next };
  }

  async proof(user: AuthUser, kind: 'sale' | 'expense', id: number, res: Response) {
    const row = kind === 'sale'
      ? await this.db.one('SELECT proof_path FROM sales WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [id, user.branchIds])
      : await this.db.one('SELECT proof_path FROM expenses WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [id, user.branchIds]);
    if (!row?.proof_path) throw new NotFoundException('Tidak ada bukti');
    const buf = await this.storage.get(row.proof_path);
    res.setHeader('Content-Type', sniffImage(buf)?.mime ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  // ---------------- Ekspor (Excel / PDF) ----------------
  async exportReport(user: AuthUser, res: Response, fmt: 'xlsx' | 'pdf', month?: string, branchId?: number) {
    const d = await this.overview(user, month, branchId);
    const cat = await this.catalog(user, branchId);
    await this.db.exec('INSERT INTO export_logs(user_id, report, filters) VALUES ($1,$2,$3)', [user.id, `kas_${fmt}`, JSON.stringify({ month: d.month, branchId: branchId ?? null })]);
    const scope = branchId ? (await this.db.one('SELECT name FROM branches WHERE id = $1', [branchId]))?.name ?? '' : user.branchIds ? 'cabang Anda' : 'semua cabang';
    const METHOD: Record<string, string> = { TUNAI: 'Tunai', TRANSFER: 'Transfer', TAGIHAN: 'Ditagihkan ke wali' };
    const STATE: Record<string, string> = { MENUNGGU: 'Menunggu persetujuan PJ', DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak', DIBATALKAN: 'Dibatalkan' };
    const status = (t: any) => t.kind === 'KELUAR' ? `${STATE[t.state] ?? t.state}${t.reason ? `: ${t.reason}` : ''}`
      : t.kind === 'JUAL' ? (t.canceled ? `Dibatalkan${t.cancelReason ? `: ${t.cancelReason}` : ''}` : t.method === 'TAGIHAN' ? (t.invoiceStatus === 'LUNAS' ? 'Tagihan lunas' : 'Tagihan belum dibayar') : 'Dihitung')
      : 'Dihitung (pelunasan dari menu Bayar)';
    const sign = (t: any) => (t.kind === 'KELUAR' ? -1 : 1);
    const meta = {
      title: `Laporan Kas — ${d.label}`, subtitle: `Rumah Tahfidz Al-Fatihah · ${scope} · ${printedBy(user.name)}`,
      summary: [['Pemasukan (penjualan barang)', rp(d.summary.masuk)], ['Pengeluaran', rp(d.summary.keluar)], ['Selisih', rp(d.summary.selisih)],
        ['Barang belum dibayar', rp(d.summary.belumDibayar)], ['Pengeluaran menunggu PJ', `${d.summary.menunggu} (${rp(d.summary.menungguNominal)})`]] as [string, string][],
    };
    const sheets: Sheet[] = [
      { name: 'Transaksi', columns: [
          { header: 'Tanggal', key: 'date', width: 11, date: true }, { header: 'Jenis', key: 'jenis', width: 11 }, { header: 'Keterangan', key: 'title', width: 32 }, { header: 'Santri / cabang', key: 'sub', width: 24 },
          { header: 'Kategori', key: 'category', width: 18 }, { header: 'Cara bayar', key: 'method', width: 14 }, { header: 'Status', key: 'status', width: 22 },
          { header: 'Nominal', key: 'amount', width: 13, money: true }, { header: 'Dihitung', key: 'counted', width: 13, money: true }],
        rows: (d.transactions as any[]).map((t) => ({ date: t.date, jenis: t.kind === 'KELUAR' ? 'Pengeluaran' : t.kind === 'JUAL' && t.method === 'TAGIHAN' ? 'Ditagihkan' : 'Pemasukan', title: t.title, sub: t.sub, category: t.category,
          method: METHOD[t.method] ?? t.method, status: status(t), amount: t.amount, counted: t.counted ? sign(t) * t.amount : 0 })),
        totals: { title: 'Selisih', counted: d.summary.selisih } },
      { name: 'Per kategori', columns: [{ header: 'Jenis', key: 'jenis', width: 14 }, { header: 'Kategori', key: 'label', width: 30 }, { header: 'Nominal', key: 'amount', width: 16, money: true }],
        rows: [...d.categories.masuk.map((c) => ({ jenis: 'Pemasukan', ...c })), ...d.categories.keluar.map((c) => ({ jenis: 'Pengeluaran', ...c }))] },
      { name: 'Barang belum dibayar', columns: [{ header: 'Tanggal', key: 'date', width: 11, date: true }, { header: 'Santri', key: 'fullName', width: 26 }, { header: 'Barang', key: 'label', width: 40 }, { header: 'Sisa', key: 'amount', width: 14, money: true }],
        rows: d.unpaid, totals: { fullName: 'Total', amount: d.summary.belumDibayar } },
      { name: 'Stok barang', columns: [{ header: 'Kategori', key: 'category', width: 18 }, { header: 'Barang', key: 'name', width: 26 }, { header: 'Harga', key: 'price', width: 12, money: true },
          ...cat.branches.map((b) => ({ header: `Stok ${b.name}`, key: `b${b.id}`, width: 11, align: 'right' as const })), { header: 'Total stok', key: 'stock', width: 10, align: 'right' as const }],
        rows: cat.itemCategories.flatMap((c) => c.items.filter((i) => i.isActive).map((i) => ({ category: c.name, name: i.name, price: i.price, stock: i.stock, ...Object.fromEntries(i.stocks.map((s) => [`b${s.branchId}`, s.qty])) }))) },
    ];
    const file = `kas-${d.month}`;
    if (fmt === 'xlsx') return sendXlsx(res, file, meta, sheets);
    sendPdf(res, file, meta, sheets, { landscape: true, footnote: 'Kas hanya mencatat penjualan barang & pengeluaran. Kolom "Dihitung" 0 = tidak masuk perhitungan (menunggu/ditolak/dibatalkan, atau tagihan barang yang belum dibayar). Uang SPP & daftar ulang ada di laporan SPP; uang pendaftaran di laporan Pendaftaran.' });
  }
}

const upload = FileInterceptor('file', { limits: { fileSize: MAX_PROOF } });

@Controller('kas')
export class KasController {
  constructor(private s: KasService) {}
  @Get() @Perm('kas.lihat') overview(@CurrentUser() u: AuthUser, @Query('month') m?: string, @Query('branchId') b?: number) { return this.s.overview(u, m, b ? Number(b) : undefined); }
  @Get('export.pdf') @Perm('kas.ekspor') exportPdf(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('month') m?: string, @Query('branchId') b?: number) { return this.s.exportReport(u, res, 'pdf', m, b ? Number(b) : undefined); }
  @Get('export.xlsx') @Perm('kas.ekspor') exportXlsx(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('month') m?: string, @Query('branchId') b?: number) { return this.s.exportReport(u, res, 'xlsx', m, b ? Number(b) : undefined); }
  @Get('catalog') @Perm('kas.lihat') catalog(@CurrentUser() u: AuthUser, @Query('branchId') b?: number) { return this.s.catalog(u, b ? Number(b) : undefined); }
  @Post('item-categories') @Perm('kas.edit') addCat(@CurrentUser() u: AuthUser, @Body() dto: ItemCategoryDto) { return this.s.createItemCategory(u, dto); }
  @Patch('item-categories/:id') @Perm('kas.edit') updCat(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ItemCategoryDto) { return this.s.updateItemCategory(u, id, dto); }
  @Post('items') @Perm('kas.edit') addItem(@CurrentUser() u: AuthUser, @Body() dto: ItemDto) { return this.s.createItem(u, dto); }
  @Patch('items/:id') @Perm('kas.edit') updItem(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ItemDto) { return this.s.updateItem(u, id, dto); }
  @Post('items/:id/stock') @Perm('kas.edit') stock(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: StockDto) { return this.s.adjustStock(u, id, dto); }
  @Get('items/:id/stock') @Perm('kas.lihat') stockHist(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.stockHistory(u, id); }
  @Post('expense-categories') @Perm('kas.edit') addECat(@CurrentUser() u: AuthUser, @Body() dto: ExpenseCategoryDto) { return this.s.createExpenseCategory(u, dto); }
  @Patch('expense-categories/:id') @Perm('kas.edit') updECat(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ExpenseCategoryDto) { return this.s.updateExpenseCategory(u, id, dto); }
  @Get('students') @Perm('kas.input') students(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.s.students(u, q); }
  @Get('students/:id/sales') @Perm('kas.lihat') studentSales(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.studentSales(u, id); }
  @Post('sales') @Perm('kas.input') @UseInterceptors(upload) sale(@CurrentUser() u: AuthUser, @Body() body: any, @UploadedFile() f?: Express.Multer.File) { return this.s.createSale(u, body, f); }
  @Post('sales/:id/cancel') @Perm('kas.setujui') cancelSale(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: ReasonDto) { return this.s.cancelSale(u, id, b.reason); }
  @Get('sales/:id/proof') @Perm('kas.lihat') saleProof(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) { return this.s.proof(u, 'sale', id, res); }
  @Post('expenses') @Perm('kas.input') @UseInterceptors(upload) expense(@CurrentUser() u: AuthUser, @Body() body: any, @UploadedFile() f?: Express.Multer.File) { return this.s.createExpense(u, body, f); }
  @Post('expenses/:id/approve') @Perm('kas.setujui') approve(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.approveExpense(u, id); }
  @Post('expenses/:id/decline') @Perm('kas.setujui') decline(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: ReasonDto) { return this.s.decline(u, id, b.reason); }
  @Get('expenses/:id/proof') @Perm('kas.lihat') expenseProof(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) { return this.s.proof(u, 'expense', id, res); }
}

@Module({ imports: [BillingModule], controllers: [KasController], providers: [KasService, AuditService, StorageService], exports: [KasService] })
export class KasModule {}
