/** Penyusun klausa WHERE dinamis dengan parameter bernomor ($1, $2, ...). */
export class Where {
  private parts: string[] = [];
  readonly params: any[] = [];
  constructor(params: any[] = []) { this.params = params; }
  /** add('s.branch_id = ANY($)', ids) — tanda "$" diganti nomor parameter. Dilewati bila value undefined/null. */
  add(clause: string, value?: any) {
    if (value === undefined || value === null || value === '') return this;
    this.params.push(value);
    this.parts.push(clause.replace('$', `$${this.params.length}`));
    return this;
  }
  raw(clause: string) { this.parts.push(clause); return this; }
  get sql() { return this.parts.length ? 'WHERE ' + this.parts.join(' AND ') : ''; }
  /** Nomor parameter berikutnya (untuk LIMIT/OFFSET dsb). */
  next(value: any) { this.params.push(value); return `$${this.params.length}`; }
}
export const today = () => new Date().toISOString().slice(0, 10);
