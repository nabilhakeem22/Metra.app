// The anchored layer, measured: it is portaled to <body> and fixed to its
// control below or (no room) above it, at the control's inline-start edge in
// either direction, and it follows the control when anything scrolls.
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnchoredLayer } from './anchored-layer';

const VIEWPORT = { width: 1280, height: 900 };
const CONTENT_HEIGHT = 300;
// The control's box: x is its physical left edge, as on a DOMRect.
let anchorRect = new DOMRect(200, 100, 300, 40);

function Harness({ dir = 'ltr', width = 'anchor' as 'anchor' | number }: { dir?: 'ltr' | 'rtl'; width?: 'anchor' | number }) {
  const anchorRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  return (
    <div dir={dir} className="glass">
      <input ref={anchorRef} aria-label="field" />
      <AnchoredLayer anchorRef={anchorRef} layerRef={layerRef} width={width} maxHeight={224} role="presentation">
        <p>list</p>
      </AnchoredLayer>
    </div>
  );
}

const layer = () => screen.getByText('list').parentElement as HTMLElement;

beforeEach(() => {
  anchorRect = new DOMRect(200, 100, 300, 40);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => VIEWPORT.width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => VIEWPORT.height });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-anchored-layer') ? CONTENT_HEIGHT : 0;
    },
  });
  HTMLInputElement.prototype.getBoundingClientRect = () => anchorRect;
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLInputElement.prototype, 'getBoundingClientRect');
});

describe('AnchoredLayer', () => {
  it('is a fixed layer on <body>, under the control, as wide as it, capped at maxHeight', () => {
    const { container } = render(<Harness />);
    expect(container.contains(layer())).toBe(false);
    expect(layer().parentElement).toBe(document.body);
    expect(layer().className).toContain('z-[70]');
    expect(layer().dataset.side).toBe('below');
    expect(layer().style.top).toBe('144px');
    expect(layer().style.bottom).toBe('auto');
    expect(layer().style.insetInlineStart).toBe('200px');
    expect(layer().style.width).toBe('300px');
    expect(layer().style.maxHeight).toBe('224px');
    expect(layer().dir).toBe('ltr');
  });

  it('in RTL starts on the control\'s right edge and reads right to left', () => {
    render(<Harness dir="rtl" />);
    expect(layer().dir).toBe('rtl');
    expect(layer().style.insetInlineStart).toBe(`${1280 - 500}px`);
  });

  it('flips above a control near the bottom of the viewport', () => {
    anchorRect = new DOMRect(200, 800, 300, 40);
    render(<Harness />);
    expect(layer().dataset.side).toBe('above');
    expect(layer().style.top).toBe('auto');
    expect(layer().style.bottom).toBe(`${900 - 800 + 4}px`);
  });

  it('a fixed width wider than the screen is capped and kept on it', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => 390 });
    anchorRect = new DOMRect(200, 100, 152, 40);
    render(<Harness width={384} />);
    expect(layer().style.width).toBe('374px');
    expect(layer().style.insetInlineStart).toBe('8px');
  });

  it('follows the control when the page (or any box in it) scrolls', () => {
    render(<Harness />);
    anchorRect = new DOMRect(200, 40, 300, 40);
    act(() => {
      document.body.dispatchEvent(new Event('scroll'));
    });
    expect(layer().style.top).toBe('84px');
  });
});
