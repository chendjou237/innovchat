import ExcelJS from 'exceljs';
import { Ctx, School, bootstrap, buildSchool, phone } from '../helpers';

// UC-05 Bulk import at the start of the year (FR-IMP-001..006).
describe('UC-05 bulk import', () => {
  let ctx: Ctx;
  let school: School;

  beforeAll(async () => {
    ctx = await bootstrap();
    school = await buildSchool(ctx, [
      ['U1', '6e A', [phone()]],
      ['U2', '6e A', [phone()]],
      ['U3', '5e B', [phone()]],
      ['U4', '3e C', [phone()]],
    ]);
  });
  afterAll(() => ctx.close());

  async function studentFile(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Élèves');
    ws.addRow(['Matricule', 'Nom', 'Prénom', 'Classe', 'Parent 1 nom', 'Parent 1 lien', 'Parent 1 téléphone', 'Parent 2 nom', 'Parent 2 lien', 'Parent 2 téléphone']);
    // 840 new students
    for (let i = 0; i < 840; i++) ws.addRow([`N${i}`, `NOM${i}`, `Prénom${i}`, ['6e A', '5e B', '3e c'][i % 3], `Parent ${i}`, 'Mère', `6${String(70000000 + i)}`, i % 2 ? `Père ${i}` : '', 'Père', i % 2 ? `6${String(80000000 + i)}` : '']);
    // 4 existing matricules → update (U1 moves to 5e B)
    ws.addRow(['U1', 'NOMU1', 'Nouveau', '5e B', 'Parent', 'Mère', '699000001']);
    for (const m of ['U2', 'U3', 'U4']) ws.addRow([m, `NOM${m}`, `Prénom${m}`, '6e A', 'Parent', 'Mère', '699000002']);
    // 6 errors: 2 unknown classes, 4 invalid phones
    ws.addRow(['E1', 'X', 'Y', '7e Z', 'P', 'Mère', '671111111']);
    ws.addRow(['E2', 'X', 'Y', 'CM2', 'P', 'Mère', '671111112']);
    for (const [i, p] of ['12345', '771234567', '+2376712', 'abc'].entries()) ws.addRow([`E${i + 3}`, 'X', 'Y', '6e A', 'P', 'Mère', p]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('downloads the template', async () => {
    const res = await ctx.agent.get('/api/v1/imports/template?kind=STUDENTS').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets[0].getRow(1).values).toContain('Parent 1 téléphone');
    expect(wb.getWorksheet('Classes')!.rowCount).toBe(4);
  });

  it('validates the whole file, previews 840 / 4 / 6 and imports the valid rows', async () => {
    const t0 = Date.now();
    const up = await ctx.agent.post('/api/v1/imports').field('kind', 'STUDENTS').attach('file', await studentFile(), 'eleves.xlsx');
    expect(up.status).toBe(201);
    expect(Date.now() - t0).toBeLessThan(30_000); // NFR-06
    expect([up.body.rowsCreated, up.body.rowsUpdated, up.body.rowsFailed]).toEqual([840, 4, 6]);
    const errors = up.body.rows.filter((r: { action: string }) => r.action === 'error');
    expect(errors.filter((r: { errors: string[] }) => r.errors[0].startsWith('Classe inconnue'))).toHaveLength(2);
    expect(errors.filter((r: { errors: string[] }) => r.errors[0].startsWith('Téléphone parent 1 invalide'))).toHaveLength(4);
    // Nothing saved before commit.
    expect(await ctx.prisma.student.count()).toBe(4);

    const commit = await ctx.agent.post(`/api/v1/imports/${up.body.id}/commit`);
    expect(commit.status).toBe(200);
    expect(await ctx.prisma.student.count()).toBe(844);
    expect(await ctx.prisma.parentContact.count({ where: { student: { matricule: { startsWith: 'N' } } } })).toBe(840 + 420);
    const u1 = await ctx.prisma.enrolment.findFirstOrThrow({ where: { studentId: school.students.U1.id }, include: { class: true } });
    expect(u1.class.name).toBe('5e B');
    // Phone search works on imported numbers (normalised + hashed).
    const found = await ctx.agent.get('/api/v1/students?q=670000005');
    expect(found.body.items[0].matricule).toBe('N5');

    const again = await ctx.agent.post(`/api/v1/imports/${up.body.id}/commit`);
    expect(again.status).toBe(409);

    const errFile = await ctx.agent.get(`/api/v1/imports/${up.body.id}/errors`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(errFile.body);
    expect(wb.worksheets[0].rowCount).toBe(7); // header + 6 rows

    const bell = await ctx.agent.get('/api/v1/notifications');
    expect(bell.body.items.some((n: { type: string }) => n.type === 'IMPORT_DONE')).toBe(true);
  });

  it('imports payments from CSV with the same mechanism (FR-IMP-006)', async () => {
    await ctx.agent.post('/api/v1/fees/installments').send({ name: '1ère tranche', due_date: '2026-10-15', default_amount_xaf: 75000 }).expect(201);
    const csv = ['Matricule;Tranche;Montant;Date;Référence', 'N1;1ère tranche;25 000;05/10/2026;RC1', 'N2;1ere tranche;75000;2026-10-06;RC2', 'N3;3e tranche;1000;05/10/2026;RC3', 'NOPE;1ère tranche;1000;05/10/2026;RC4'].join('\n');
    const up = await ctx.agent.post('/api/v1/imports').field('kind', 'PAYMENTS').attach('file', Buffer.from(csv), 'paiements.csv');
    expect(up.status).toBe(201);
    expect([up.body.rowsCreated, up.body.rowsFailed]).toEqual([2, 2]);
    await ctx.agent.post(`/api/v1/imports/${up.body.id}/commit`).expect(200);
    expect(await ctx.prisma.payment.count()).toBe(2);
    const dup = await ctx.agent.post('/api/v1/imports').field('kind', 'PAYMENTS').attach('file', Buffer.from(csv), 'paiements.csv');
    expect(dup.body.rows[0].errors[0]).toContain('déjà enregistré');
  });
});
