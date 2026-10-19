import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { generateChargeControlId, GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { signOfflineControlId, SignOfflineDialog } from '@/components/contracts/sign-offline-dialog';
import type { ActionResult } from '@/lib/actions/result';
import { CONTRACT_CHARGE_FIELDS } from '@/lib/contracts/charges-input';
import type { ContractHeaderDetail } from '@/lib/contracts/queries';
import { scheduleLabelPath, scheduleValuePath } from '@/lib/contracts/schedule/input';
import type { ContractScheduleView } from '@/lib/contracts/schedule/queries';
import { SIGN_OFFLINE_FIELDS } from '@/lib/contracts/sign-offline-input';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { chargeControlId, ChargesForm } from './charges-form';
import { ContractHeaderForm } from './contract-header-form';
import { scheduleLabelControlId, scheduleValueControlId } from './schedule-rows';
import { SCHEDULE_TOTAL_ID, ScheduleTab } from './schedule-tab';

// PR A3.4 (AC 19 for the execution forms): the Generate dialog, the Charges
// form, the Schedule tab and the offline-signature dialog each say every
// refusal under the box it is about, in both locales; an execution contract's
// header has no advance or retention box.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const contracts = vi.hoisted(() => ({
  generateExecutionContract: vi.fn(),
  setContractCharges: vi.fn(),
  saveContractSchedule: vi.fn(),
  recordContractSignedOffline: vi.fn(),
  saveContractDraft: vi.fn(),
}));
vi.mock('@/lib/contracts/actions', () => contracts);

const DETAIL = {
  id: 'k-1',
  status: 'draft',
  sourceBoqId: 'b-1',
  signatureDate: null,
  startDate: null,
  endDate: null,
  advancePct: '0',
  retentionPct: '0',
  paymentTermsDays: null,
  defectsLiabilityDays: null,
  termsEn: null,
  termsAr: null,
  taxRate: '14.0000',
  supervisionPct: '10.0000',
  taxableBase: '100000.0000',
  taxAmount: '14000.0000',
  supervisionAmount: '10000.0000',
  originalValue: '124000.0000',
} as unknown as ContractHeaderDetail;

const NO_SCHEDULE: ContractScheduleView = { rows: [], valid: false };
const SCHEDULE_FIELDS = ['milestones', ...[0, 1, 2].flatMap((index) => [scheduleLabelPath(index), scheduleValuePath(index)])];

/** A schedule path's box: a row's label or value, or the total under which the sum is said. */
function scheduleControlOf(path: string): string {
  const [, row, box] = path.split('.');
  if (row === undefined) return SCHEDULE_TOTAL_ID;
  return box === 'label' ? scheduleLabelControlId(Number(row)) : scheduleValueControlId(Number(row));
}

beforeEach(() => {
  for (const action of Object.values(contracts)) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('execution contract forms (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = (ui: React.ReactElement) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(ui, { locale });
  };
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };

  test('the Generate dialog: VAT and the supervision fee', async () => {
    show(<GenerateExecutionContract boqId="b-1" />);
    await press(at('contracts.execution.generate.open'))();
    await expectFieldErrorsRenderUnderFields({
      fields: CONTRACT_CHARGE_FIELDS,
      controlIdOf: generateChargeControlId,
      answerWith: (result: ActionResult) => contracts.generateExecutionContract.mockResolvedValue(result),
      submit: press(at('contracts.execution.generate.submit')),
      locale,
      typed: { [generateChargeControlId('taxRate')]: '14' },
    });
  });

  test('the Charges form', async () => {
    show(<ChargesForm detail={DETAIL} m={(value) => value} />);
    await expectFieldErrorsRenderUnderFields({
      fields: CONTRACT_CHARGE_FIELDS,
      controlIdOf: chargeControlId,
      answerWith: (result: ActionResult) => contracts.setContractCharges.mockResolvedValue(result),
      submit: press(at('contracts.execution.charges.save')),
      locale,
      typed: { [chargeControlId('supervisionPct')]: '10' },
    });
  });

  test('the Schedule tab: each row label and value, and the sum under the total', async () => {
    show(
      <ScheduleTab contractId="k-1" status="draft" canManage schedule={NO_SCHEDULE} contract={DETAIL} m={(value) => value} />,
    );
    await expectFieldErrorsRenderUnderFields({
      fields: SCHEDULE_FIELDS,
      controlIdOf: scheduleControlOf,
      answerWith: (result: ActionResult) => contracts.saveContractSchedule.mockResolvedValue(result),
      submit: press(at('contracts.execution.schedule.save')),
      locale,
      typed: { [scheduleValueControlId(0)]: '50' },
    });
  });

  test('the Schedule tab refuses a split that does not add up before sending it', async () => {
    show(
      <ScheduleTab contractId="k-1" status="draft" canManage schedule={NO_SCHEDULE} contract={DETAIL} m={(value) => value} />,
    );
    fireEvent.change(document.getElementById(scheduleValueControlId(2))!, { target: { value: '10' } });
    await press(at('contracts.execution.schedule.save'))();
    expect(contracts.saveContractSchedule).not.toHaveBeenCalled();
    expect(document.getElementById(`${SCHEDULE_TOTAL_ID}-error`)?.textContent).toBe(
      at('errors.field.schedule_sum_mismatch').replace('{actual}', '90').replace('{expected}', '100'),
    );
  });

  test('the offline signature dialog: the day and the note', async () => {
    show(<SignOfflineDialog contractId="k-1" />);
    await press(at('contracts.execution.signOffline.open'))();
    await expectFieldErrorsRenderUnderFields({
      fields: SIGN_OFFLINE_FIELDS,
      controlIdOf: signOfflineControlId,
      answerWith: (result: ActionResult) => contracts.recordContractSignedOffline.mockResolvedValue(result),
      submit: press(at('contracts.execution.signOffline.submit')),
      locale,
    });
  });

  test('an execution contract header has no advance or retention box', () => {
    show(<ContractHeaderForm detail={DETAIL} />);
    expect(document.getElementById('ch-advancePct')).toBeNull();
    expect(document.getElementById('ch-retentionPct')).toBeNull();
    expect(document.getElementById('ch-startDate')).not.toBeNull();
  });
});
