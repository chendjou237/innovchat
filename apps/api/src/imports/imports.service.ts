import { Injectable } from '@nestjs/common';
import { ImportKind, normalizePhone, toDay } from '@innovcare/shared';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { AuditService } from '../core/audit.service';
import { CryptoService } from '../core/crypto.service';
import { badRequest, conflict, notFound } from '../core/errors';
import { PrismaService } from '../core/prisma.service';
import { Column, buildXlsx } from '../core/xlsx';
import { LedgerService } from '../fees/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgService } from '../org/org.service';
import { StudentsService } from '../students/students.service';

export const MAX_ROWS = 5000; // FR-IMP-002

type Cell = string;
type RawRow = Record<string, Cell>;

export interface PreviewRow {
  row: number; // line number in the file (header = 1)
  action: 'create' | 'update' | 'error';
  data: Record<string, string>;
  errors: string[];
}

interface FieldSpec {
  key: string;
  header: string;
  aliases: string[];
  width?: number;
}

const STUDENT_FIELDS: FieldSpec[] = [
  { key: 'matricule', header: 'Matricule', aliases: ['matricule', 'mat'] },
  { key: 'last_name', header: 'Nom', aliases: ['nom', 'nom eleve', 'last name'], width: 20 },
  { key: 'first_name', header: 'Prénom', aliases: ['prenom', 'prenoms', 'first name'], width: 20 },
  { key: 'class', header: 'Classe', aliases: ['classe', 'class'] },
  { key: 'p1_name', header: 'Parent 1 nom', aliases: ['parent 1 nom', 'parent1 nom', 'nom parent 1'], width: 22 },
  { key: 'p1_rel', header: 'Parent 1 lien', aliases: ['parent 1 lien', 'parent 1 relation', 'parent1 lien'] },
  { key: 'p1_phone', header: 'Parent 1 téléphone', aliases: ['parent 1 telephone', 'parent 1 tel', 'parent 1 whatsapp', 'parent1 telephone'], width: 20 },
  { key: 'p2_name', header: 'Parent 2 nom', aliases: ['parent 2 nom', 'parent2 nom', 'nom parent 2'], width: 22 },
  { key: 'p2_rel', header: 'Parent 2 lien', aliases: ['parent 2 lien', 'parent 2 relation', 'parent2 lien'] },
  { key: 'p2_phone', header: 'Parent 2 téléphone', aliases: ['parent 2 telephone', 'parent 2 tel', 'parent 2 whatsapp', 'parent2 telephone'], width: 20 },
];

const PAYMENT_FIELDS: FieldSpec[] = [
  { key: 'matricule', header: 'Matricule', aliases: ['matricule', 'mat'] },
  { key: 'installment', header: 'Tranche', aliases: ['tranche', 'installment', 'echeance'], width: 18 },
  { key: 'amount', header: 'Montant (FCFA)', aliases: ['montant', 'montant fcfa', 'montant xaf', 'amount'] },
  { key: 'paid_on', header: 'Date de paiement', aliases: ['date', 'date de paiement', 'date paiement', 'paye le'] },
  { key: 'reference', header: 'Référence', aliases: ['reference', 'ref', 'recu', 'numero recu'] },
];

const fieldsFor = (kind: ImportKind) => (kind === 'STUDENTS' ? STUDENT_FIELDS : PAYMENT_FIELDS);

export function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return toDay(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    return '';
  }
  return String(v).trim();
}

/** "05/10/2026", "5/10/26", "2026-10-05" or an Excel serial number → "2026-10-05". */
export function parseDateCell(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return Number.isNaN(Date.parse(d)) ? null : d;
  }
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Bulk import of students or payments: validate everything, preview, then commit (FR-IMP-001..006, UC-05). */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly students: StudentsService,
    private readonly crypto: CryptoService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Downloadable template (FR-IMP-001), with the active year's classes or installments on a second sheet. */
  async template(kind: ImportKind): Promise<Buffer> {
    const fields = fieldsFor(kind);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind === 'STUDENTS' ? 'Élèves' : 'Paiements');
    ws.columns = fields.map((f) => ({ header: f.header, key: f.key, width: f.width ?? 16 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // Phone and matricule columns as text so Excel keeps leading digits intact.
    for (const f of fields) if (/phone|matricule|reference/.test(f.key)) ws.getColumn(f.key).numFmt = '@';
    const year = await this.org.activeYearOrNull();
    if (kind === 'STUDENTS') {
      ws.addRow({ matricule: 'EX0001', last_name: 'NGONO', first_name: 'Awa', class: '6e A', p1_name: 'Marie Ngono', p1_rel: 'Mère', p1_phone: '671234567' });
      const ref = wb.addWorksheet('Classes');
      ref.columns = [{ header: 'Classes de l’année active', key: 'name', width: 30 }];
      if (year) for (const c of await this.prisma.class.findMany({ where: { academicYearId: year.id }, orderBy: { name: 'asc' } })) ref.addRow({ name: c.name });
    } else {
      ws.addRow({ matricule: 'EX0001', installment: '1ère tranche', amount: 25000, paid_on: '05/10/2026', reference: 'RC-0001' });
      const ref = wb.addWorksheet('Tranches');
      ref.columns = [{ header: 'Tranches de l’année active', key: 'name', width: 30 }];
      if (year) for (const i of await this.prisma.feeInstallment.findMany({ where: { academicYearId: year.id }, orderBy: { dueDate: 'asc' } })) ref.addRow({ name: i.name });
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async parse(fileName: string, buffer: Buffer, kind: ImportKind): Promise<{ rows: RawRow[]; lineOffset: number }> {
    const fields = fieldsFor(kind);
    let table: string[][];
    if (/\.csv$/i.test(fileName)) {
      const text = buffer.toString('utf8').replace(/^﻿/, '');
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimiter: '' });
      table = parsed.data.map((r) => r.map((c) => String(c ?? '').trim()));
    } else if (/\.xlsx$/i.test(fileName)) {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      } catch {
        throw badRequest('INVALID_FILE', 'Fichier Excel illisible.');
      }
      const ws = wb.worksheets[0];
      if (!ws) throw badRequest('INVALID_FILE', 'Le fichier ne contient aucune feuille.');
      table = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const values: string[] = [];
        for (let c = 1; c <= Math.max(ws.columnCount, fields.length); c++) values.push(cellText(row.getCell(c).value));
        table[n - 1] = values;
      });
      table = Array.from(table, (r) => r ?? []);
    } else {
      throw badRequest('INVALID_FILE', 'Formats acceptés : .xlsx et .csv.');
    }

    const header = (table[0] ?? []).map(normHeader);
    const colOf = new Map<string, number>();
    for (const f of fields) {
      const idx = header.findIndex((h) => f.aliases.includes(h));
      if (idx >= 0) colOf.set(f.key, idx);
    }
    const required = kind === 'STUDENTS' ? ['matricule', 'last_name', 'first_name', 'class'] : ['matricule', 'installment', 'amount', 'paid_on'];
    const missing = fields.filter((f) => required.includes(f.key) && !colOf.has(f.key)).map((f) => f.header);
    if (missing.length) throw badRequest('MISSING_COLUMNS', `Colonnes manquantes : ${missing.join(', ')}. Utilisez le modèle à télécharger.`);

    const rows: RawRow[] = [];
    for (let i = 1; i < table.length; i++) {
      const r = table[i] ?? [];
      if (r.every((c) => !c)) {
        rows.push({ __empty: '1' });
        continue;
      }
      const o: RawRow = {};
      for (const [k, idx] of colOf) o[k] = (r[idx] ?? '').trim();
      rows.push(o);
    }
    // Drop trailing empty lines but keep line numbers of the others.
    while (rows.length && rows[rows.length - 1].__empty) rows.pop();
    const dataRows = rows.filter((r) => !r.__empty).length;
    if (dataRows > MAX_ROWS) throw badRequest('TOO_MANY_ROWS', `Le fichier contient ${dataRows} lignes (maximum ${MAX_ROWS}).`);
    return { rows, lineOffset: 2 };
  }

  /** Uploads and validates the whole file before saving anything (FR-IMP-003/004). */
  async upload(kind: ImportKind, fileName: string, buffer: Buffer, actorId: string) {
    const { rows, lineOffset } = await this.parse(fileName, buffer, kind);
    const preview = kind === 'STUDENTS' ? await this.validateStudents(rows, lineOffset) : await this.validatePayments(rows, lineOffset);
    const job = await this.prisma.importJob.create({
      data: {
        kind,
        fileName,
        rowsTotal: preview.length,
        rowsCreated: preview.filter((r) => r.action === 'create').length,
        rowsUpdated: preview.filter((r) => r.action === 'update').length,
        rowsFailed: preview.filter((r) => r.action === 'error').length,
        preview: { rows: preview } as object,
        createdBy: actorId,
      },
    });
    return this.view(job.id);
  }

  private async validateStudents(rows: RawRow[], lineOffset: number): Promise<PreviewRow[]> {
    const year = await this.org.activeYear();
    const classes = await this.prisma.class.findMany({ where: { academicYearId: year.id } });
    const classByName = new Map(classes.map((c) => [c.name.trim().toLowerCase().replace(/\s+/g, ' '), c]));
    const existing = new Set((await this.prisma.student.findMany({ select: { matricule: true } })).map((s) => s.matricule));
    const seen = new Map<string, number>();
    const out: PreviewRow[] = [];

    rows.forEach((r, i) => {
      if (r.__empty) return;
      const line = i + lineOffset;
      const errors: string[] = [];
      const data: Record<string, string> = { ...r };
      for (const [k, label] of [['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['class', 'Classe']] as const) {
        if (!r[k]) errors.push(`${label} manquant`);
      }
      if (r.class) {
        const cls = classByName.get(r.class.trim().toLowerCase().replace(/\s+/g, ' '));
        if (!cls) errors.push(`Classe inconnue dans l'année active : ${r.class}`);
        else data.class_id = cls.id;
      }
      if (r.matricule) {
        const prev = seen.get(r.matricule);
        if (prev) errors.push(`Matricule en double dans le fichier (ligne ${prev})`);
        else seen.set(r.matricule, line);
      }
      if (!r.p1_phone) errors.push('Téléphone du parent 1 manquant');
      for (const p of ['p1', 'p2'] as const) {
        const raw = r[`${p}_phone`];
        if (!raw) continue;
        const e164 = normalizePhone(raw);
        if (!e164) errors.push(`Téléphone ${p === 'p1' ? 'parent 1' : 'parent 2'} invalide : ${raw}`);
        else data[`${p}_e164`] = e164;
      }
      if (r.p2_phone && !r.p2_name) data.p2_name = 'Parent 2';
      if (r.p1_phone && !r.p1_name) data.p1_name = 'Parent 1';
      out.push({ row: line, action: errors.length ? 'error' : existing.has(r.matricule) ? 'update' : 'create', data, errors });
    });
    return out;
  }

  private async validatePayments(rows: RawRow[], lineOffset: number): Promise<PreviewRow[]> {
    const year = await this.org.activeYear();
    const installments = await this.prisma.feeInstallment.findMany({ where: { academicYearId: year.id } });
    const instByName = new Map(installments.map((i) => [normHeader(i.name), i]));
    const enrolments = await this.prisma.enrolment.findMany({ where: { academicYearId: year.id }, select: { id: true, student: { select: { matricule: true } } } });
    const enrolByMat = new Map(enrolments.map((e) => [e.student.matricule, e.id]));
    const refs = new Set(
      (await this.prisma.payment.findMany({ where: { reference: { not: null }, studentFee: { enrolment: { academicYearId: year.id } } }, select: { reference: true, studentFeeId: true } })).map(
        (p) => `${p.studentFeeId}:${p.reference}`,
      ),
    );
    const fees = await this.prisma.studentFee.findMany({ where: { enrolment: { academicYearId: year.id } }, select: { id: true, enrolmentId: true, installmentId: true } });
    const feeId = new Map(fees.map((f) => [`${f.enrolmentId}:${f.installmentId}`, f.id]));
    const seenRefs = new Map<string, number>();
    const out: PreviewRow[] = [];

    rows.forEach((r, i) => {
      if (r.__empty) return;
      const line = i + lineOffset;
      const errors: string[] = [];
      const data: Record<string, string> = { ...r };
      const enrolmentId = r.matricule ? enrolByMat.get(r.matricule) : undefined;
      if (!r.matricule) errors.push('Matricule manquant');
      else if (!enrolmentId) errors.push(`Élève inconnu dans l'année active : ${r.matricule}`);
      else data.enrolment_id = enrolmentId;
      const inst = r.installment ? instByName.get(normHeader(r.installment)) : undefined;
      if (!r.installment) errors.push('Tranche manquante');
      else if (!inst) errors.push(`Tranche inconnue : ${r.installment}`);
      else data.installment_id = inst.id;
      const amount = Number(String(r.amount ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
      if (!r.amount) errors.push('Montant manquant');
      else if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) errors.push(`Montant invalide : ${r.amount}`);
      else data.amount_xaf = String(amount);
      const day = r.paid_on ? parseDateCell(r.paid_on) : null;
      if (!r.paid_on) errors.push('Date manquante');
      else if (!day) errors.push(`Date invalide : ${r.paid_on}`);
      else data.paid_on_day = day;
      if (r.reference && enrolmentId && inst) {
        const sf = feeId.get(`${enrolmentId}:${inst.id}`);
        const k = `${enrolmentId}:${inst.id}:${r.reference}`;
        if (sf && refs.has(`${sf}:${r.reference}`)) errors.push(`Paiement déjà enregistré (référence ${r.reference})`);
        else if (seenRefs.has(k)) errors.push(`Référence en double dans le fichier (ligne ${seenRefs.get(k)})`);
        else seenRefs.set(k, line);
      }
      out.push({ row: line, action: errors.length ? 'error' : 'create', data, errors });
    });
    return out;
  }

  async view(id: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) throw notFound('Import introuvable');
    const { errorFile: _e, preview, ...rest } = job;
    return { ...rest, has_error_file: !!job.errorFile || job.rowsFailed > 0, rows: ((preview as { rows?: PreviewRow[] }).rows ?? []) };
  }

  async list() {
    return this.prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, kind: true, fileName: true, status: true, rowsTotal: true, rowsCreated: true, rowsUpdated: true, rowsFailed: true, createdAt: true },
    });
  }

  cancel(id: string) {
    return this.prisma.importJob.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'CANCELLED' } });
  }

  /** Imports the valid rows and skips the rest (FR-IMP-005). */
  async commit(id: string, actorId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) throw notFound('Import introuvable');
    if (job.status !== 'PREVIEW') throw conflict('IMPORT_NOT_PENDING', 'Cet import a déjà été validé ou annulé.');
    const rows = ((job.preview as { rows?: PreviewRow[] }).rows ?? []).filter((r) => r.action !== 'error');
    // Mark first so a double click cannot import twice.
    const lock = await this.prisma.importJob.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'COMMITTED' } });
    if (lock.count === 0) throw conflict('IMPORT_NOT_PENDING', 'Cet import a déjà été validé.');

    let created = 0;
    let updated = 0;
    try {
      if (job.kind === 'STUDENTS') ({ created, updated } = await this.commitStudents(rows));
      else created = await this.commitPayments(rows, id);
    } catch (e) {
      await this.prisma.importJob.update({ where: { id }, data: { status: 'PREVIEW' } });
      throw e;
    }

    const errorFile = job.rowsFailed > 0 ? await this.errorFile(job.id) : null;
    await this.prisma.importJob.update({ where: { id }, data: { rowsCreated: created, rowsUpdated: updated, errorFile: errorFile ? new Uint8Array(errorFile) : null } });
    await this.audit.log(actorId, 'IMPORT', 'import_job', id, { kind: job.kind, created, updated, failed: job.rowsFailed });
    await this.notifications.raise(
      'IMPORT_DONE',
      `Import ${job.kind === 'STUDENTS' ? 'des élèves' : 'des paiements'} terminé : ${created} créés, ${updated} mis à jour, ${job.rowsFailed} en erreur`,
      `/import/${id}`,
      `import-${id}`,
    );
    return this.view(id);
  }

  private async commitStudents(rows: PreviewRow[]) {
    const year = await this.org.activeYear();
    let created = 0;
    let updated = 0;
    const touched: string[] = [];
    // Chunks keep each transaction short; validation already passed for every row.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await this.prisma.$transaction(
        async (tx) => {
          for (const { data: d, action } of chunk) {
            const contacts = (['p1', 'p2'] as const)
              .filter((p) => d[`${p}_e164`])
              .map((p) => ({ name: d[`${p}_name`] || (p === 'p1' ? 'Parent 1' : 'Parent 2'), relationship: d[`${p}_rel`] ?? '', e164: d[`${p}_e164`] }));
            let student = await tx.student.findUnique({ where: { matricule: d.matricule } });
            if (!student) {
              student = await tx.student.create({ data: { matricule: d.matricule, firstName: d.first_name, lastName: d.last_name } });
              created++;
            } else {
              student = await tx.student.update({
                where: { id: student.id },
                data: { firstName: d.first_name, lastName: d.last_name, status: student.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE' },
              });
              if (action === 'update') updated++;
              else created++;
            }
            const enrolment = await tx.enrolment.upsert({
              where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } },
              create: { studentId: student.id, classId: d.class_id, academicYearId: year.id },
              update: { classId: d.class_id },
            });
            touched.push(enrolment.id);
            const existing = await tx.parentContact.findMany({ where: { studentId: student.id } });
            for (const c of contacts) {
              const hash = this.crypto.phoneHash(c.e164);
              const same = existing.find((e) => e.phoneHash === hash);
              if (same) await tx.parentContact.update({ where: { id: same.id }, data: { name: c.name, relationship: c.relationship } });
              else await tx.parentContact.create({ data: { studentId: student.id, ...this.students.contactData({ name: c.name, relationship: c.relationship, phone: c.e164 }) } });
            }
          }
        },
        { timeout: 120_000 },
      );
    }
    await this.ledger.syncEnrolments(touched);
    return { created, updated };
  }

  private async commitPayments(rows: PreviewRow[], jobId: string) {
    const enrolmentIds = [...new Set(rows.map((r) => r.data.enrolment_id))];
    await this.ledger.syncEnrolments(enrolmentIds);
    const fees = await this.prisma.studentFee.findMany({ where: { enrolmentId: { in: enrolmentIds } }, select: { id: true, enrolmentId: true, installmentId: true } });
    const feeId = new Map(fees.map((f) => [`${f.enrolmentId}:${f.installmentId}`, f.id]));
    const data = rows.map((r) => ({
      studentFeeId: feeId.get(`${r.data.enrolment_id}:${r.data.installment_id}`)!,
      amountXaf: Number(r.data.amount_xaf),
      paidOn: new Date(`${r.data.paid_on_day}T00:00:00Z`),
      reference: r.data.reference || null,
      importJobId: jobId,
    }));
    for (let i = 0; i < data.length; i += 1000) await this.prisma.payment.createMany({ data: data.slice(i, i + 1000) });
    return data.length;
  }

  /** Rows in error, as an Excel file to correct and re-upload (FR-IMP-005). */
  async errorFile(id: string): Promise<Buffer> {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) throw notFound('Import introuvable');
    if (job.errorFile) return Buffer.from(job.errorFile);
    const fields = fieldsFor(job.kind);
    const rows = ((job.preview as { rows?: PreviewRow[] }).rows ?? []).filter((r) => r.action === 'error');
    const columns: Column[] = [...fields.map((f) => ({ header: f.header, key: f.key, width: f.width ?? 16 })), { header: 'Erreur', key: '__error', width: 50 }];
    return buildXlsx(
      'Erreurs',
      columns,
      rows.map((r) => ({ ...Object.fromEntries(fields.map((f) => [f.key, r.data[f.key] ?? ''])), __error: `Ligne ${r.row} : ${r.errors.join(' ; ')}` })),
    );
  }
}
