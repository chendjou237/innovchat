import { useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';

const UPDATED = '14 octobre 2026';

/**
 * Politique de confidentialité — public page (no login), also used as the privacy
 * policy URL required by Meta for the WhatsApp Business app.
 * Describes what the application actually stores and sends; the school, as data
 * controller, should review it before publication.
 */
export default function Privacy() {
  const school = useQuery({
    queryKey: ['public-school'],
    queryFn: () => api.get<{ name: string; phone: string }>('/public/school'),
    retry: false,
  });
  const name = school.data?.name || 'L’établissement';
  const phone = school.data?.phone;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-4 sm:px-6">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">Innovcare</div>
            <div className="text-[13px] text-muted">Notifications WhatsApp de {name}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-[28px] font-semibold tracking-tight">Politique de confidentialité</h1>
        <p className="mt-2 text-sm text-muted">Dernière mise à jour : {UPDATED}</p>

        <div className="mt-6 rounded-xl border border-line bg-white p-4 text-[15px] leading-relaxed">
          <strong>En bref.</strong> {name} utilise Innovcare pour informer les parents par WhatsApp des absences, retards,
          frais scolaires et événements de l’école. Nous n’utilisons ces données que pour cela, nous ne les vendons pas et
          nous ne faisons pas de publicité. Vous pouvez à tout moment demander à ne plus recevoir de messages.
        </div>

        <Section title="1. Qui est responsable de vos données ?">
          <p>
            Le responsable du traitement est <strong>{name}</strong>
            {phone && (
              <>
                , joignable au <strong>{phone}</strong>
              </>
            )}
            . Innovcare est l’outil utilisé par l’établissement pour gérer et envoyer ces notifications.
          </p>
        </Section>

        <Section title="2. Quelles données traitons-nous ?">
          <ul>
            <li>
              <strong>Élèves</strong> : nom, prénom, matricule, classe et année scolaire, résultat de passage en classe
              supérieure.
            </li>
            <li>
              <strong>Parents et tuteurs</strong> : nom, lien avec l’élève, numéro WhatsApp, date du consentement à
              recevoir des messages, éventuelle demande de ne plus en recevoir.
            </li>
            <li>
              <strong>Vie scolaire</strong> : absences (date, matière, créneau) et retards (date, heure d’arrivée), avec
              leur éventuelle justification. Les élèves présents ne sont pas enregistrés.
            </li>
            <li>
              <strong>Frais scolaires</strong> : montants dus par tranche, paiements reçus (montant, date, référence du
              reçu) et solde restant.
            </li>
            <li>
              <strong>Messages envoyés</strong> : contenu, destinataire, date et statut de remise (envoyé, distribué, lu
              ou échec).
            </li>
            <li>
              <strong>Personnel administratif</strong> : nom, adresse e-mail, journal des actions effectuées dans
              l’application.
            </li>
          </ul>
        </Section>

        <Section title="3. Pourquoi ?">
          <ul>
            <li>Prévenir les parents d’une absence ou d’un retard de leur enfant.</li>
            <li>Rappeler les frais scolaires restant à payer, avec le montant propre à chaque élève.</li>
            <li>Annoncer les réunions, examens, congés et autres événements de l’école.</li>
            <li>Diffuser les informations générales de l’établissement.</li>
            <li>Suivre la bonne remise des messages et garder une trace des envois.</li>
          </ul>
          <p>
            Ces traitements reposent sur le consentement des parents, recueilli à l’inscription, et sur l’intérêt de
            l’établissement à informer les familles de la scolarité de leurs enfants. Aucune décision automatisée ni
            aucun profilage n’est réalisé.
          </p>
        </Section>

        <Section title="4. Messages WhatsApp">
          <p>
            Les messages sont envoyés depuis le numéro WhatsApp Business de l’établissement via la plateforme WhatsApp
            Business de Meta, à partir de modèles approuvés par Meta. Chaque alerte d’absence ou de retard est relue et
            confirmée par un administrateur avant l’envoi.
          </p>
          <p>
            Ce numéro <strong>ne lit pas les réponses</strong>. Pour toute question, contactez directement l’établissement
            {phone ? ` au ${phone}` : ''}.
          </p>
        </Section>

        <Section title="5. Qui a accès aux données ?">
          <ul>
            <li>Les administrateurs de l’établissement, avec un compte personnel protégé par mot de passe.</li>
            <li>
              <strong>Meta Platforms</strong> (WhatsApp), qui reçoit le numéro du destinataire et le contenu du message pour
              l’acheminer, selon ses propres conditions.
            </li>
            <li>
              Notre <strong>hébergeur</strong>, qui stocke l’application et la base de données sur des serveurs situés en
              Union européenne (Francfort, Allemagne).
            </li>
          </ul>
          <p>Les données ne sont ni vendues, ni louées, ni utilisées à des fins publicitaires.</p>
        </Section>

        <Section title="6. Combien de temps ?">
          <p>
            Les données sont conservées pendant la scolarité de l’élève dans l’établissement. L’historique des années
            précédentes reste consultable par l’établissement pour le suivi de la scolarité. Les données d’un élève et de
            ses parents peuvent être effacées sur demande (voir ci-dessous) : les envois passés sont alors conservés sans
            nom ni numéro de téléphone.
          </p>
        </Section>

        <Section title="7. Sécurité">
          <ul>
            <li>Les numéros de téléphone des parents et les identifiants WhatsApp sont chiffrés dans la base de données.</li>
            <li>Toutes les connexions passent par HTTPS.</li>
            <li>
              L’accès est réservé aux administrateurs ; les sessions expirent après 8 heures d’inactivité et le compte est
              bloqué temporairement après plusieurs tentatives de connexion échouées.
            </li>
            <li>Les actions importantes (envois, imports, modifications) sont enregistrées dans un journal.</li>
          </ul>
        </Section>

        <Section title="8. Vos droits">
          <p>
            Conformément à la législation camerounaise relative à la protection des données à caractère personnel, vous
            pouvez demander à l’établissement :
          </p>
          <ul>
            <li>l’accès aux données vous concernant ou concernant votre enfant, et leur copie ;</li>
            <li>la correction d’une information inexacte, par exemple un numéro de téléphone ;</li>
            <li>l’arrêt des messages WhatsApp : votre numéro est alors exclu de tous les envois ;</li>
            <li>l’effacement de vos données et de celles de votre enfant.</li>
          </ul>
          <p>
            Adressez votre demande à {name}
            {phone ? `, au ${phone}` : ''} ou auprès de son secrétariat. Les réponses envoyées au numéro WhatsApp ne sont pas
            lues.
          </p>
        </Section>

        <Section title="9. Cookies">
          <p>
            Seul un cookie de session est utilisé, pour garder les administrateurs connectés. Il n’y a ni cookie
            publicitaire ni outil de mesure d’audience. Les parents n’ont pas besoin de compte et ne se connectent pas à
            l’application.
          </p>
        </Section>

        <Section title="10. Modifications">
          <p>
            Cette politique peut être mise à jour. La date de dernière mise à jour figure en haut de cette page.
          </p>
        </Section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl justify-between px-4 py-5 text-[13px] text-muted sm:px-6">
          <span>© {new Date().getFullYear()} {name}</span>
          <Link to="/" className="hover:text-ink hover:underline">
            Espace administrateur
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[15px] leading-relaxed text-stone-700 [&_li]:pl-1 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
