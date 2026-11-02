import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';

// The lead's rulings on the design-first copy, verbatim (F4, F5), and the trigger
// label nothing renders, gone (F6). The two fix-round sentences name what the studio
// can actually do on the page that shows them.

describe('design_open and the ending hint (F4, F5)', () => {
  it('say only what can be done from where the studio stands', () => {
    expect(en.errors.design_open).toBe('Design is still open on delivery {delivery}. Finish it with the client from the delivery page, then come back here.');
    expect(ar.errors.design_open).toBe('التصميم لسه شغال على التسليم {delivery}. خلّص التصميم مع العميل من صفحة التسليم، وبعدين كمّل هنا.');
    expect(en.engagements.command.ending.hint).toBe("Record the client's decision. Execution can't be undone. Design only can still continue to execution after the client confirms receipt.");
    expect(ar.engagements.command.ending.hint).toBe('سجّل قرار العميل. التنفيذ مفيهوش رجوع. والتصميم بس تقدر تكمّل منه للتنفيذ بعد ما العميل يأكّد الاستلام.');
  });
});

describe('boq_version_in_progress (R-F1)', () => {
  it('says to issue the draft, then create the contract from it', () => {
    expect(en.errors.boq_version_in_progress).toBe('A new version of this BOQ is still a draft. Open the BOQ tab and issue it, then create the contract from it.');
    expect(ar.errors.boq_version_in_progress).toBe('فيه نسخة جديدة من المقايسة دي لسه مسودة. افتح تبويب المقايسة واصدرها، وبعدين اعمل العقد منها.');
  });
});

describe('the fix round (F1, F2, F6)', () => {
  it.each([['en', en], ['ar-EG', ar]] as const)('%s: boq_not_on_home names the button on this page; the trigger label is gone', (_locale, bundle) => {
    expect(bundle.errors.boq_not_on_home).toContain(bundle.projects.profile.boq.newVersion);
    expect(bundle.errors.boq_delivery_abandoned.length).toBeGreaterThan(0);
    expect(bundle.engagements.trigger).not.toHaveProperty('continueToExecution');
  });
});
