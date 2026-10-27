import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { callerIpBucket } = await import('./caller-bucket');

const bucketOf = (headers: Record<string, string>) => callerIpBucket(new Headers(headers));

describe('callerIpBucket', () => {
  it('keys an IPv4 caller whole', () => {
    expect(bucketOf({ 'cf-connecting-ip': '1.2.3.4' })).toBe('1.2.3.4');
  });

  it('is null without cf-connecting-ip, and never reads x-forwarded-for', () => {
    expect(bucketOf({})).toBeNull();
    expect(bucketOf({ 'x-forwarded-for': '6.6.6.6' })).toBeNull();
  });

  it('keys an IPv6 caller by its /64, however it is written', () => {
    const buckets = [
      '2001:0db8:1234:5678:aaaa:bbbb:cccc:dddd',
      '2001:0DB8:1234:5678:1111:2222:3333:4444',
    ].map((ip) => bucketOf({ 'cf-connecting-ip': ip }));
    expect(buckets).toEqual(['2001:db8:1234:5678', '2001:db8:1234:5678']);
  });

  it('expands a compressed address before taking the /64', () => {
    const buckets = ['2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0003', '2001:DB8::ffff:4'].map((ip) =>
      bucketOf({ 'cf-connecting-ip': ip }),
    );
    expect(buckets).toEqual(['2001:db8:0:0', '2001:db8:0:0', '2001:db8:0:0']);
  });

  it('keeps distinct /64s distinct', () => {
    expect(bucketOf({ 'cf-connecting-ip': '2001:db8:0:1::1' })).toBe('2001:db8:0:1');
  });

  it('keys an address it cannot expand whole', () => {
    expect(bucketOf({ 'cf-connecting-ip': '::FFFF:1.2.3.4' })).toBe('::ffff:1.2.3.4');
    expect(bucketOf({ 'cf-connecting-ip': '::1' })).toBe('0:0:0:0');
  });
});
