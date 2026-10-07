import { describe, expect, it } from 'vitest';
import { reminderChannels } from './channels';

// F6: the client record the studio edits wins over the primary contact's copy.
const client = { phone: '01122223333', email: 'new@client.example' };
const seededContact = { whatsapp: null, phone: '01000000000', email: 'old@client.example' };

describe('reminderChannels', () => {
  it("after the client's phone and email are edited, both channels use the edit", () => {
    expect(reminderChannels({ client, primaryContact: seededContact })).toEqual({
      phone: '01122223333',
      email: 'new@client.example',
    });
  });

  it("a WhatsApp number typed on the contact on purpose wins for WhatsApp only", () => {
    expect(
      reminderChannels({ client, primaryContact: { ...seededContact, whatsapp: ' 01555555555 ' } }),
    ).toEqual({ phone: '01555555555', email: 'new@client.example' });
  });

  it('the contact fills in only what the client record lacks', () => {
    expect(
      reminderChannels({ client: { phone: '  ', email: null }, primaryContact: seededContact }),
    ).toEqual({ phone: '01000000000', email: 'old@client.example' });
  });

  it('no contact, nothing on file: both null', () => {
    expect(reminderChannels({ client: { phone: null, email: '' }, primaryContact: null })).toEqual({
      phone: null,
      email: null,
    });
  });
});
