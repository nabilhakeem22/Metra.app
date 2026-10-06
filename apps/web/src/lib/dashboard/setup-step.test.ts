import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '../permissions/member-roles';
import { can } from '../permissions/can';
import { deliveriesEmptyState, nextSetupStep } from './setup-step';

const NOTHING = { hasClient: false, hasProject: false, hasEngagement: false };
const CLIENT_ONLY = { ...NOTHING, hasClient: true };
const READY = { ...CLIENT_ONLY, hasProject: true };
const DONE = { ...READY, hasEngagement: true };

describe('nextSetupStep', () => {
  it('walks client -> project -> delivery for an owner, then stops', () => {
    expect(nextSetupStep('owner', NOTHING)?.href).toBe('/clients?new=1');
    expect(nextSetupStep('owner', CLIENT_ONLY)?.href).toBe('/projects?new=1');
    expect(nextSetupStep('owner', READY)?.href).toBe('/engagements?new=1');
    expect(nextSetupStep('owner', DONE)).toBeNull();
  });

  it('never hands a role a create link it does not hold', () => {
    const capability = {
      '/clients?new=1': 'clients',
      '/projects?new=1': 'projects',
      '/engagements?new=1': 'engagements_design',
    } as const;
    for (const role of MEMBER_ROLES) {
      for (const progress of [NOTHING, CLIENT_ONLY, READY]) {
        const step = nextSetupStep(role, progress);
        if (step) {
          const href = step.href as keyof typeof capability;
          expect(can(role, capability[href], 'create'), `${role} ${href}`).toBe(true);
        }
      }
    }
  });

  it('a viewer gets no step at all', () => {
    for (const progress of [NOTHING, CLIENT_ONLY, READY]) {
      expect(nextSetupStep('viewer', progress)).toBeNull();
    }
  });
});

describe('deliveriesEmptyState', () => {
  it('names the first missing prerequisite, with its step', () => {
    expect(deliveriesEmptyState('owner', NOTHING)).toEqual({
      reason: 'noClient',
      cta: { messageKey: 'ctaAddClient', href: '/clients?new=1' },
    });
    expect(deliveriesEmptyState('owner', CLIENT_ONLY).reason).toBe('noProject');
    expect(deliveriesEmptyState('owner', READY)).toEqual({
      reason: 'noDelivery',
      cta: { messageKey: 'ctaStartDelivery', href: '/engagements?new=1' },
    });
  });

  it('says every delivery is closed only when one ever existed', () => {
    expect(deliveriesEmptyState('owner', DONE)).toEqual({
      reason: 'allClosed',
      cta: { messageKey: 'ctaStartDelivery', href: '/engagements?new=1' },
    });
    expect(deliveriesEmptyState('viewer', DONE)).toEqual({ reason: 'allClosed', cta: null });
  });
});
