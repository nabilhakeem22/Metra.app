'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { homeNamesSource } from '@/lib/client-home/names';
import type { HomeFocus } from '@/lib/client-home/tab';
import type { HomeAtExecution, HomeChangeOrder } from '@/lib/client-home/types';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { deliveryDisplayNames } from '@/lib/engagements/public/display-names';
import { HomeTabs } from './home-tabs';
import { ExecutionChangeOrders } from './portal/execution-change-orders';
import { ExecutionContract } from './portal/execution-contract';
import { ExecutionHero } from './portal/execution-hero';
import { ExecutionPayments } from './portal/execution-payments';
import { Greeting } from './portal/greeting';
import { StudioBar } from './portal/studio-bar';
import { useFocusSection } from './portal/use-focus-section';

/**
 * The client home's EXECUTION tab, read from ONE token SDF (./home-read.ts),
 * and with it the contract's document while it awaits the client's signature
 * and the change orders while some await the client's decision:
 * the studio bar, the greeting, the tab strip when the delivery began with a
 * design (a light delivery has only this tab), then the hero (where the
 * client stands and the one thing to do) and, in this order, the contract,
 * the change orders waiting for the client, and the payments. One column on a
 * phone, two from lg up. A `?focus=` link opens on its section, a request's
 * opens its "I've made this payment" on the code box, and a signing's
 * (`sign:<id>`) or a change order's (`variation:<id>`) has its code box ready
 * for the client's own press. فصحى copy, Latin digits, logical CSS only; nothing
 * here is a fact of the studio's own (lib/client-home/types.ts).
 */
export function ExecutionTabView({
  token,
  home,
  signingDocument,
  changeOrders,
  focus,
}: {
  token: string;
  home: HomeAtExecution;
  /** The contract awaiting the client's signature, read with the page; null in every other state, or when its read failed. */
  signingDocument: ContractDocument | null;
  /** The change orders awaiting the client's decision, read with the page; null when none is open, or when their read failed. */
  changeOrders: HomeChangeOrder[] | null;
  focus: HomeFocus | null;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();
  const router = useRouter();
  useFocusSection(focus);
  const { execution } = home;
  const { firmName, title, clientName } = deliveryDisplayNames(homeNamesSource(home), locale);
  const startedWithDesign = home.delivery.entryPhase === 'design';
  const studio = { name: firmName, whatsappDigits: home.firm.whatsappDigits, deliveryRef: home.delivery.documentNumber };

  return (
    <div className="client-portal min-h-screen">
      <StudioBar
        firmName={firmName}
        firm={home.firm}
        deliveryRef={home.delivery.documentNumber}
        token={token}
        locale={locale}
        tab="execution"
        wide
      />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4 lg:max-w-5xl">
        <Greeting clientName={clientName} title={title} />
        {startedWithDesign && <HomeTabs token={token} current="execution" />}
        {/* One column on a phone, in the plan's order (hero, contract, change
            orders, payments). From lg up two columns, the hero over the
            payments beside the contract over the change orders: each column
            is its own stack, so a tall card never opens a gap in the other. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <div className="contents lg:flex lg:flex-col lg:gap-4">
            <div className="order-1">
              <ExecutionHero
                execution={execution}
                firmName={firmName}
                whatsappDigits={home.firm.whatsappDigits}
                deliveryRef={home.delivery.documentNumber}
              />
            </div>
            {execution.money && (
              <div className="order-4">
                <ExecutionPayments
                  token={token}
                  initial={execution.money}
                  onChanged={() => router.refresh()}
                  channel={home.codeChannel}
                  openOn={focus?.section === 'request' ? focus.id : null}
                  studio={studio}
                />
              </div>
            )}
          </div>
          <div className="contents lg:flex lg:flex-col lg:gap-4">
            <div className="order-2">
              <ExecutionContract
                token={token}
                execution={execution}
                firmName={firmName}
                showsDesignRecord={startedWithDesign}
                signing={{
                  document: signingDocument,
                  channel: home.codeChannel,
                  studio,
                  openOn: focus?.section === 'sign' ? focus.id : null,
                  onChanged: () => router.refresh(),
                }}
              />
            </div>
            <ExecutionChangeOrders
              token={token}
              orders={changeOrders}
              openCount={execution.openVariationCount}
              channel={home.codeChannel}
              studio={studio}
              openOn={focus?.section === 'variation' ? focus.id : null}
              onChanged={() => router.refresh()}
            />
          </div>
        </div>
        <footer className="pt-2 text-center text-caption text-muted-foreground">{t('poweredBy', { firm: firmName })}</footer>
      </div>
    </div>
  );
}
