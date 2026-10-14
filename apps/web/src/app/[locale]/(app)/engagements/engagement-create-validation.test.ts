import { describe, expect, it } from 'vitest';
import { deliveryFieldFor } from './engagement-create-validation';

describe('deliveryFieldFor', () => {
  it('puts each refusal under the field it is about', () => {
    expect(deliveryFieldFor('engagement_title_required')).toBe('title');
    expect(deliveryFieldFor('engagement_client_required')).toBe('client');
    expect(deliveryFieldFor('engagement_project_required')).toBe('project');
    expect(deliveryFieldFor('project_delivery_exists')).toBe('project');
    expect(deliveryFieldFor('project_delivery_limit_reached')).toBe('project');
  });

  it('keeps everything else above the form', () => {
    expect(deliveryFieldFor('forbidden')).toBe('form');
    expect(deliveryFieldFor('generic')).toBe('form');
    expect(deliveryFieldFor('flow_not_enabled')).toBe('form');
  });
});
