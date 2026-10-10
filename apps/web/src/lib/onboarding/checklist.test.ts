import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '../permissions/member-roles';
import { can } from '../permissions/can';
import { buildChecklist } from './checklist';
import type { OnboardingProgress } from './progress';

const NONE: OnboardingProgress = {
  profileComplete: false,
  teamInvited: false,
  hasClient: false,
  hasProject: false,
  hasEngagement: false,
  hasSharedDelivery: false,
  newestUnsharedDeliveryId: null,
  hasClientPageDetails: false,
};

describe('buildChecklist', () => {
  it('viewer (no create grants) -> items:[] , percent 0, not allDone', () => {
    const r = buildChecklist(NONE, 'viewer', false);
    expect(r.items).toEqual([]);
    expect(r.percent).toBe(0);
    expect(r.allDone).toBe(false);
  });

  it('owner gets the steps around the first delivery, then the client page details, in order', () => {
    const r = buildChecklist(NONE, 'owner', false);
    expect(r.items.map((i) => i.key)).toEqual([
      'completeProfile',
      'addClient',
      'addProject',
      'startDelivery',
      'shareDelivery',
      'clientPageDetails',
    ]);
    expect(r.percent).toBe(0);
  });

  it('every item is offered only to a role that may do it', () => {
    for (const role of MEMBER_ROLES) {
      for (const item of buildChecklist(NONE, role, false).items) {
        expect(can(role, item.capability, item.action), `${role} ${item.key}`).toBe(true);
      }
    }
  });

  it('project_manager gets client, project and delivery, but never the share step', () => {
    const r = buildChecklist(NONE, 'project_manager', false);
    expect(r.items.map((i) => i.key)).toEqual(['addClient', 'addProject', 'startDelivery']);
  });

  it('the create steps open their forms and launch their tour stops', () => {
    const byKey = Object.fromEntries(
      buildChecklist(NONE, 'owner', false).items.map((item) => [item.key, item]),
    );
    expect(byKey.addClient).toMatchObject({ href: '/clients?new=1', tourStep: 'clients' });
    expect(byKey.addProject).toMatchObject({ href: '/projects?new=1', tourStep: 'projects' });
    expect(byKey.startDelivery).toMatchObject({ href: '/engagements?new=1', tourStep: 'deliveries' });
    expect(byKey.shareDelivery).toMatchObject({ href: '/engagements', tourStep: null });
  });

  it('share opens the newest unshared delivery with its link dialog, and ticks once shared', () => {
    const waiting = { ...NONE, hasEngagement: true, newestUnsharedDeliveryId: 'e-9' };
    const share = buildChecklist(waiting, 'owner', false).items.find((i) => i.key === 'shareDelivery');
    expect(share).toMatchObject({ href: '/engagements/e-9?share=1', done: false });
    const shared = buildChecklist({ ...waiting, hasSharedDelivery: true }, 'owner', false);
    expect(shared.items.find((i) => i.key === 'shareDelivery')?.done).toBe(true);
    expect(shared.items.find((i) => i.key === 'startDelivery')?.done).toBe(true);
  });

  it('percent counts only INCLUDED items; allDone when every included item is done', () => {
    // PM has 3 items; mark 2 done -> 67%.
    const p: OnboardingProgress = { ...NONE, hasClient: true, hasProject: true };
    const r = buildChecklist(p, 'project_manager', false);
    expect(r.percent).toBe(67);
    expect(r.allDone).toBe(false);

    const done = buildChecklist({ ...p, hasEngagement: true }, 'project_manager', false);
    expect(done.percent).toBe(100);
    expect(done.allDone).toBe(true);
  });

  it('the client page details open their Settings card, are owner/admin only, and tick once saved', () => {
    const owner = buildChecklist(NONE, 'owner', false).items.find((i) => i.key === 'clientPageDetails');
    expect(owner).toMatchObject({ href: '/settings#client-page', tourStep: null, done: false });
    expect(buildChecklist(NONE, 'admin', false).items.some((i) => i.key === 'clientPageDetails')).toBe(true);
    expect(buildChecklist(NONE, 'project_manager', false).items.some((i) => i.key === 'clientPageDetails')).toBe(false);
    const saved = buildChecklist({ ...NONE, hasClientPageDetails: true }, 'owner', false);
    expect(saved.items.find((i) => i.key === 'clientPageDetails')?.done).toBe(true);
  });
});
