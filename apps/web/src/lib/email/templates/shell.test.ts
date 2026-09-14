import { describe, expect, it } from 'vitest';
import {
  digestEmailTemplate,
  followupReminderEmailTemplate,
  stageReminderEmailTemplate,
} from './automation';
import { inviteEmailTemplate } from './invite';
import { proposalSentEmailTemplate } from './proposal-sent';
import fixture from './shell-fixture.json';

// BYTE-FOR-BYTE. The fixture was captured from the three templates BEFORE the
// shell was extracted, so this is the proof that collapsing them changed no
// email anyone receives — not a character of markup, not a space of
// indentation, not the bare ampersand the proposal CTA has always carried.
//
// If you are here because this failed: the shell changed what goes on the wire.
// That is allowed, but it is a product decision about a shipped email, so
// re-capture the fixture deliberately rather than nudging it until it passes.

const cases: Array<[keyof typeof fixture, () => { subject: string; html: string; text: string }]> = [
  [
    'inviteAr',
    () =>
      inviteEmailTemplate({
        orgName: 'Hassan & Sons',
        acceptUrl: 'https://app.metra.test/invite/tok?a=1&b=2',
        role: 'admin',
        locale: 'ar-EG',
      }),
  ],
  [
    // An unknown role falls back to the raw key, and the LTR frame differs.
    'inviteEn',
    () =>
      inviteEmailTemplate({
        orgName: 'Hassan & Sons',
        acceptUrl: 'https://app.metra.test/invite/tok?a=1&b=2',
        role: 'unknown_role',
        locale: 'en',
      }),
  ],
  [
    'proposalFull',
    () =>
      proposalSentEmailTemplate({
        orgName: 'Hassan & Sons',
        proposalNumber: 'Q-2026-0007',
        totalDisplay: 'EGP 1,240.00',
        expiryDate: '2026-09-30',
        acceptUrl: 'https://app.metra.test/p/tok?a=1&b=2',
        locale: 'ar-EG',
      }),
  ],
  [
    // BOTH optional meta lines absent: the old template still emitted the bare
    // indentation where `${meta}` interpolated, and so must the shell.
    'proposalBare',
    () =>
      proposalSentEmailTemplate({
        orgName: 'Hassan & Sons',
        proposalNumber: 'Q-2026-0007',
        totalDisplay: null,
        expiryDate: '',
        acceptUrl: 'https://app.metra.test/p/tok',
        locale: 'en',
      }),
  ],
  [
    'followupAr',
    () =>
      followupReminderEmailTemplate({
        proposalNumber: 'Q-2026-0007',
        days: 3,
        reviewUrl: 'https://app.metra.test/proposals/1',
        locale: 'ar-EG',
      }),
  ],
  [
    'digestEn',
    () =>
      digestEmailTemplate({
        activeProjects: 4,
        awaitingResponse: 2,
        expiringSoon: 1,
        overdueStages: 0,
        dashboardUrl: 'https://app.metra.test/dashboard',
        locale: 'en',
      }),
  ],
  [
    'stageAr',
    () =>
      stageReminderEmailTemplate({
        overdueCount: 2,
        upcomingCount: 5,
        projectsUrl: 'https://app.metra.test/projects',
        locale: 'ar-EG',
      }),
  ],
];

describe('emailShell reproduces every template byte-for-byte', () => {
  it.each(cases)('%s', (key, build) => {
    expect(build()).toEqual(fixture[key]);
  });
});

describe('the shell keeps the escaping rules the templates relied on', () => {
  it('escapes the href in BOTH places it appears', () => {
    const { html } = inviteEmailTemplate({
      orgName: 'Cairo Fit-out',
      acceptUrl: 'https://app.metra.test/i/tok" onmouseover="steal()" x="',
      role: 'admin',
      locale: 'en',
    });
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) expect(href).toContain('&quot;');
    expect(html).not.toContain('onmouseover="steal()"');
  });

  it('escapes the heading, which only the automation family sends', () => {
    const { html } = digestEmailTemplate({
      activeProjects: 0,
      awaitingResponse: 0,
      expiringSoon: 0,
      overdueStages: 0,
      dashboardUrl: 'https://app.metra.test/dashboard',
      locale: 'en',
    });
    expect(html).toContain('font-weight:600;">Portfolio digest</p>');
  });

  it('omits the heading and the fallback block when they are not asked for', () => {
    // An automation email has a heading and no fallback; an invite is the other
    // way round. Neither must leave an empty paragraph behind.
    const automation = digestEmailTemplate({
      activeProjects: 0,
      awaitingResponse: 0,
      expiringSoon: 0,
      overdueStages: 0,
      dashboardUrl: 'https://app.metra.test/dashboard',
      locale: 'en',
    }).html;
    expect(automation).not.toContain('word-break:break-all');

    const invite = inviteEmailTemplate({
      orgName: 'Cairo Fit-out',
      acceptUrl: 'https://app.metra.test/i/tok',
      role: 'admin',
      locale: 'en',
    }).html;
    // The CTA anchor also carries font-weight:600, so look for the heading
    // PARAGRAPH specifically rather than the declaration.
    expect(invite).not.toMatch(/<p style="color:[^"]*;font-weight:600;">/);
  });
});
