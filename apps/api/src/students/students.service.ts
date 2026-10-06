import { Injectable } from '@nestjs/common';
import { maskPhone, normalizePhone, parseDay } from '@innovcare/shared';
import { Prisma } from '@prisma/client';
import { CryptoService } from '../core/crypto.service';
import { badRequest, notFound } from '../core/errors';
import { PrismaService, Tx } from '../core/prisma.service';
import { LedgerService } from '../fees/ledger.service';
import { OrgService } from '../org/org.service';

export interface ContactInput {
  name: string;
  relationship?: string;
  phone: string;
  consentAt?: string;
  isOptedOut?: boolean;
}

export interface StudentListQuery {
  q?: string;
  classId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly org: OrgService,
    private readonly ledger: LedgerService,
  ) {}

  /** Normalises (FR-STU-003), encrypts and hashes a parent number. Throws 400 if invalid. */
  phoneFields(raw: string) {
    const e164 = normalizePhone(raw);
    if (!e164) throw badRequest('INVALID_PHONE', `Numéro invalide : ${raw}`);
    return { phoneE164: this.crypto.encrypt(e164), phoneHash: this.crypto.phoneHash(e164), phoneMasked: maskPhone(e164) };
  }

  contactData(c: ContactInput) {
    return {
      name: c.name,
      relationship: c.relationship ?? '',
      ...this.phoneFields(c.phone),
      // Consent is recorded at registration or import (SRS §2.4).
      consentAt: c.consentAt ? parseDay(c.consentAt) : new Date(),
      isOptedOut: c.isOptedOut ?? false,
    };
  }

  async list(query: StudentListQuery) {
    const year = await this.org.activeYearOrNull();
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where: Prisma.StudentWhereInput = {};
    where.status = (query.status as never) || 'ACTIVE';
    if (query.status === 'ALL') delete where.status;
    if (query.classId) where.enrolments = { some: { classId: query.classId } };

    const q = query.q?.trim();
    if (q) {
      const phone = normalizePhone(q);
      const or: Prisma.StudentWhereInput[] = [
        { matricule: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
      ];
      // "Nom Prénom" or "Prénom Nom"
      const parts = q.split(/\s+/);
      if (parts.length >= 2) {
        or.push({ AND: [{ lastName: { contains: parts[0], mode: 'insensitive' } }, { firstName: { contains: parts.slice(1).join(' '), mode: 'insensitive' } }] });
        or.push({ AND: [{ firstName: { contains: parts[0], mode: 'insensitive' } }, { lastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' } }] });
      }
      // Exact phone search via the keyed hash, without decrypting (FR-STU-005).
      if (phone) or.push({ contacts: { some: { phoneHash: this.crypto.phoneHash(phone) } } });
      // Class name search
      if (year) or.push({ enrolments: { some: { academicYearId: year.id, class: { name: { equals: q, mode: 'insensitive' } } } } });
      where.OR = or;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contacts: { select: { id: true, name: true, relationship: true, phoneMasked: true, isOptedOut: true } },
          enrolments: { where: year ? { academicYearId: year.id } : undefined, include: { class: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((s) => ({
        id: s.id,
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        status: s.status,
        class: s.enrolments[0]?.class ?? null,
        contacts: s.contacts,
      })),
    };
  }

  async detail(id: string) {
    const s = await this.prisma.student.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { createdAt: 'asc' } },
        enrolments: { include: { class: true, academicYear: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!s) throw notFound('Élève introuvable');
    const enrolmentIds = s.enrolments.map((e) => e.id);
    const [anomalies, fees, messages] = await Promise.all([
      this.prisma.attendanceAnomaly.findMany({
        where: { enrolmentId: { in: enrolmentIds } },
        include: { subject: true, dispatch: { select: { id: true, status: true } } },
        orderBy: { date: 'desc' },
        take: 200,
      }),
      this.prisma.studentFee.findMany({
        where: { enrolmentId: { in: enrolmentIds } },
        include: { installment: true, payments: { orderBy: { paidOn: 'desc' } } },
        orderBy: { installment: { dueDate: 'asc' } },
      }),
      this.prisma.message.findMany({
        where: { studentId: id },
        include: { dispatch: { select: { id: true, title: true, purpose: true, source: true } }, contact: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    return {
      id: s.id,
      matricule: s.matricule,
      firstName: s.firstName,
      lastName: s.lastName,
      status: s.status,
      enrolments: s.enrolments,
      contacts: s.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        relationship: c.relationship,
        phone: this.crypto.decrypt(c.phoneE164),
        phoneMasked: c.phoneMasked,
        consentAt: c.consentAt,
        isOptedOut: c.isOptedOut,
      })),
      anomalies,
      fees: fees.map((f) => {
        const paid = f.payments.reduce((a, p) => a + p.amountXaf, 0);
        return { ...f, paid, balance: Math.max(0, f.amountDueXaf - paid) };
      }),
      messages: messages.map(({ phoneE164: _p, ...m }) => m),
    };
  }

  async create(input: { matricule: string; firstName: string; lastName: string; classId: string; contacts: ContactInput[] }) {
    const year = await this.org.activeYear();
    const cls = await this.prisma.class.findUnique({ where: { id: input.classId } });
    if (!cls || cls.academicYearId !== year.id) throw badRequest('CLASS_NOT_IN_ACTIVE_YEAR', "La classe n'appartient pas à l'année active.");
    const contacts = input.contacts.map((c) => this.contactData(c));
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          matricule: input.matricule,
          firstName: input.firstName,
          lastName: input.lastName,
          contacts: { create: contacts },
        },
      });
      const enrolment = await tx.enrolment.create({ data: { studentId: student.id, classId: cls.id, academicYearId: year.id } });
      await this.ledger.syncEnrolments([enrolment.id], tx);
      return student;
    });
  }

  async update(id: string, input: { matricule?: string; firstName?: string; lastName?: string; classId?: string; status?: 'ACTIVE' | 'LEFT' | 'ARCHIVED' }) {
    const { classId, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.update({ where: { id }, data: fields });
      if (classId) await this.moveToClass(id, classId, tx);
      return student;
    });
  }

  /** Changes the student's class in the active year (creates the enrolment if missing). */
  async moveToClass(studentId: string, classId: string, tx: Tx) {
    const year = await this.org.activeYear(tx);
    const cls = await tx.class.findUnique({ where: { id: classId } });
    if (!cls || cls.academicYearId !== year.id) throw badRequest('CLASS_NOT_IN_ACTIVE_YEAR', "La classe n'appartient pas à l'année active.");
    const enrolment = await tx.enrolment.upsert({
      where: { studentId_academicYearId: { studentId, academicYearId: year.id } },
      create: { studentId, classId, academicYearId: year.id },
      update: { classId },
    });
    await this.ledger.syncEnrolments([enrolment.id], tx);
  }

  async addContact(studentId: string, c: ContactInput) {
    await this.prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    return this.prisma.parentContact.create({ data: { studentId, ...this.contactData(c) }, select: { id: true } });
  }

  async updateContact(studentId: string, contactId: string, c: Partial<ContactInput>) {
    const data: Prisma.ParentContactUpdateInput = {};
    if (c.name !== undefined) data.name = c.name;
    if (c.relationship !== undefined) data.relationship = c.relationship;
    if (c.phone !== undefined) Object.assign(data, this.phoneFields(c.phone));
    if (c.consentAt !== undefined) data.consentAt = parseDay(c.consentAt);
    if (c.isOptedOut !== undefined) data.isOptedOut = c.isOptedOut;
    const res = await this.prisma.parentContact.updateMany({ where: { id: contactId, studentId }, data: data as Prisma.ParentContactUpdateManyMutationInput });
    if (res.count === 0) throw notFound('Contact introuvable');
    return { ok: true };
  }

  async removeContact(studentId: string, contactId: string) {
    const used = await this.prisma.message.count({ where: { parentContactId: contactId } });
    if (used > 0) {
      // Messages keep their history: mark the contact opted out instead of deleting it.
      await this.prisma.parentContact.updateMany({ where: { id: contactId, studentId }, data: { isOptedOut: true } });
      return { ok: true, optedOut: true };
    }
    await this.prisma.parentContact.deleteMany({ where: { id: contactId, studentId } });
    return { ok: true };
  }

  /** Personal data export on request (NFR-14). */
  async exportData(id: string) {
    const d = await this.detail(id);
    return { exportedAt: new Date().toISOString(), student: d };
  }

  /**
   * Erasure on request (NFR-14): personal fields are anonymised. Message rows stay
   * (they are never hard-deleted, §4.3) but lose the phone number.
   */
  async erase(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.student.findUniqueOrThrow({ where: { id } });
      const anon = this.crypto.encrypt('+000000000000');
      await tx.parentContact.updateMany({
        where: { studentId: id },
        data: { name: 'Effacé', relationship: '', phoneE164: anon, phoneHash: 'erased', phoneMasked: '—', isOptedOut: true },
      });
      await tx.message.updateMany({ where: { studentId: id }, data: { phoneE164: anon, phoneMasked: '—' } });
      await tx.student.update({
        where: { id },
        data: { firstName: 'Effacé', lastName: 'Effacé', matricule: `EFFACE-${s.id.slice(0, 8)}`, status: 'ARCHIVED' },
      });
    });
    return { ok: true };
  }
}
