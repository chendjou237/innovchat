import 'reflect-metadata';
import { maskPhone, parseDay } from '@innovcare/shared';
import { PrismaClient, TemplatePurpose, MetaCategory } from '@prisma/client';
import { AuthService } from './auth/auth.service';
import { env } from './core/config';
import { CryptoService } from './core/crypto.service';
import { PrismaService } from './core/prisma.service';
import { LedgerService } from './fees/ledger.service';

/** Default French templates (FR-TPL-004). Submit them in WhatsApp Manager with the same names. */
export const DEFAULT_TEMPLATES: {
  metaName: string;
  title: string;
  purpose: TemplatePurpose;
  metaCategory: MetaCategory;
  bodyPreview: string;
  parameterMap: string[];
}[] = [
  {
    metaName: 'retard_eleve',
    title: 'Retard',
    purpose: 'TARDINESS',
    metaCategory: 'UTILITY',
    bodyPreview:
      "Bonjour {{1}}, nous vous informons que votre enfant {{2}} ({{3}}) est arrivé(e) en retard le {{4}} à {{5}}. Ce numéro ne lit pas les réponses ; pour joindre l'école : {{6}}.",
    parameterMap: ['parent_name', 'student_full_name', 'class_name', 'date', 'arrival_time', 'school_phone'],
  },
  {
    metaName: 'absence_eleve',
    title: 'Absence',
    purpose: 'ABSENCE',
    metaCategory: 'UTILITY',
    bodyPreview:
      "Bonjour {{1}}, nous vous informons que votre enfant {{2}} ({{3}}) a été absent(e) le {{4}} au cours de {{5}} (créneau : {{6}}). Ce numéro ne lit pas les réponses ; pour joindre l'école : {{7}}.",
    parameterMap: ['parent_name', 'student_full_name', 'class_name', 'date', 'subject', 'time_slot', 'school_phone'],
  },
  {
    metaName: 'rappel_frais',
    title: 'Rappel de frais',
    purpose: 'PAYMENT',
    metaCategory: 'UTILITY',
    bodyPreview:
      "Bonjour {{1}}, le solde de la {{2}} de {{3}} ({{4}}) s'élève à {{5}} FCFA, à régler avant le {{6}}. Si vous avez déjà payé, merci de ne pas tenir compte de ce message. Ce numéro ne lit pas les réponses ; pour joindre l'école : {{7}}.",
    parameterMap: ['parent_name', 'installment_name', 'student_full_name', 'class_name', 'balance_due', 'due_date', 'school_phone'],
  },
  {
    metaName: 'evenement_ecole',
    title: 'Événement du calendrier',
    purpose: 'CALENDAR',
    metaCategory: 'UTILITY',
    bodyPreview:
      "Bonjour {{1}}, {{2}} vous informe : {{3}}, {{4}} à {{5}}. Lieu : {{6}}. Ce numéro ne lit pas les réponses ; pour joindre l'école : {{7}}.",
    parameterMap: ['parent_name', 'school_name', 'event_title', 'event_date', 'event_time', 'event_place', 'school_phone'],
  },
  {
    metaName: 'annonce_generale',
    title: 'Annonce générale',
    purpose: 'GENERAL',
    // Meta may classify general announcements as Marketing, which costs more (§6.2).
    metaCategory: 'MARKETING',
    bodyPreview:
      "Bonjour {{1}}, message de {{2}} concernant {{3}} : {{4}}. Ce numéro ne lit pas les réponses ; pour joindre l'école : {{5}}.",
    parameterMap: ['parent_name', 'school_name', 'student_full_name', 'param:message', 'school_phone'],
  },
];

const FIRST = ['Awa', 'Brice', 'Carine', 'Daniel', 'Estelle', 'Franck', 'Grâce', 'Hervé', 'Inès', 'Junior', 'Kévin', 'Laure', 'Marius', 'Nadège', 'Olivier', 'Prisca'];
const LAST = ['NGONO', 'MBARGA', 'ESSOMBA', 'FOTSO', 'TCHOUA', 'NJOYA', 'ATANGANA', 'KAMGA', 'BELLA', 'ONANA', 'NKOULOU', 'EYENGA'];

export async function seed(prisma: PrismaClient, opts: { sample: boolean; studentsPerClass?: number } = { sample: false }) {
  const crypto = new CryptoService();

  if ((await prisma.adminUser.count()) === 0) {
    await prisma.adminUser.create({
      data: { email: env().SEED_ADMIN_EMAIL.toLowerCase(), fullName: 'Administrateur', passwordHash: await AuthService.hash(env().SEED_ADMIN_PASSWORD) },
    });
    console.log(`Administrateur créé : ${env().SEED_ADMIN_EMAIL}`);
  }

  for (const t of DEFAULT_TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { metaName_language: { metaName: t.metaName, language: 'fr' } },
      create: { ...t, language: 'fr', metaStatus: 'PENDING' },
      update: {},
    });
  }

  const defaults: Record<string, string> = { school_name: 'Collège Exemple', school_phone: '+237 222 00 00 00' };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  if (!opts.sample || (await prisma.academicYear.count()) > 0) return;

  const year = await prisma.academicYear.create({
    data: { label: '2026-2027', startDate: parseDay('2026-09-07'), endDate: parseDay('2027-06-30'), isActive: true },
  });
  const premier = await prisma.department.create({ data: { name: 'Premier cycle' } });
  const second = await prisma.department.create({ data: { name: 'Second cycle' } });
  for (const name of ['Mathématiques', 'Français', 'Anglais', 'Histoire-Géographie', 'SVT', 'Physique-Chimie', 'EPS', 'Informatique']) {
    await prisma.subject.create({ data: { name } });
  }
  const classDefs = [
    ['6e A', '6e', premier.id],
    ['6e B', '6e', premier.id],
    ['5e A', '5e', premier.id],
    ['5e B', '5e', premier.id],
    ['4e A', '4e', premier.id],
    ['4e B', '4e', premier.id],
    ['3e A', '3e', premier.id],
    ['2nde A', '2nde', second.id],
    ['1ère A', '1ère', second.id],
    ['Tle A', 'Tle', second.id],
  ] as const;

  const perClass = opts.studentsPerClass ?? 8;
  let n = 0;
  const enrolmentIds: string[] = [];
  for (const [name, level, departmentId] of classDefs) {
    const cls = await prisma.class.create({ data: { name, level, departmentId, academicYearId: year.id } });
    for (let i = 0; i < perClass; i++) {
      n++;
      const first = FIRST[n % FIRST.length];
      const last = LAST[(n * 7) % LAST.length];
      // Deterministic numbers; a few end in 0000/0004 to exercise the mock's failure paths.
      const phone = n % 23 === 0 ? `+2376990${String(n).padStart(1, '0').slice(-1)}0000` : `+2376${String(70000000 + n * 1373).slice(0, 8)}`;
      const student = await prisma.student.create({
        data: {
          matricule: `MAT${String(n).padStart(4, '0')}`,
          firstName: first,
          lastName: last,
          contacts:
            n % 17 === 0
              ? undefined // a few students without a contact
              : {
                  create: [
                    {
                      name: `${n % 2 ? 'Mme' : 'M.'} ${last}`,
                      relationship: n % 2 ? 'Mère' : 'Père',
                      phoneE164: crypto.encrypt(phone),
                      phoneHash: crypto.phoneHash(phone),
                      phoneMasked: maskPhone(phone),
                      consentAt: parseDay('2026-09-07'),
                    },
                  ],
                },
        },
      });
      const e = await prisma.enrolment.create({ data: { studentId: student.id, classId: cls.id, academicYearId: year.id } });
      enrolmentIds.push(e.id);
    }
  }
  await prisma.feeInstallment.create({ data: { academicYearId: year.id, name: '1ère tranche', dueDate: parseDay('2026-10-15'), defaultAmountXaf: 75000 } });
  await prisma.feeInstallment.create({ data: { academicYearId: year.id, name: '2e tranche', dueDate: parseDay('2027-01-15'), defaultAmountXaf: 60000 } });
  await new LedgerService(prisma as PrismaService).syncEnrolments(enrolmentIds);
  console.log(`Données d'exemple : ${n} élèves dans ${classDefs.length} classes.`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma, { sample: env().SEED_SAMPLE_DATA })
    .then(() => console.log('Seed terminé.'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
