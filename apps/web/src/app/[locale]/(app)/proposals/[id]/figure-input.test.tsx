import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FigureInput } from './figure-input';

function Box({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <FigureInput aria-label="qty" value={value} onValueChange={setValue} />;
}

afterEach(cleanup);

describe('FigureInput: on blur the box shows the Latin-digit figure that is saved', () => {
  it.each([
    ['١٢', '12'],
    ['١٢٫٥', '12.5'],
    ['1,000', '1000'],
    ['7.', '7'],
  ])('typed %s reads %s after blur', (typed, shown) => {
    render(<Box initial="" />);
    const box = screen.getByLabelText('qty') as HTMLInputElement;
    fireEvent.change(box, { target: { value: typed } });
    expect(box.value).toBe(typed);
    fireEvent.blur(box);
    expect(box.value).toBe(shown);
  });

  it('leaves what it cannot read as typed (1,5 never becomes 15)', () => {
    render(<Box initial="1,5" />);
    const box = screen.getByLabelText('qty') as HTMLInputElement;
    fireEvent.blur(box);
    expect(box.value).toBe('1,5');
  });
});

function StoredBox({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <FigureInput
      aria-label="price"
      value={value}
      onValueChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('FigureInput: a stored scale-4 figure shows without trailing zeros', () => {
  it('reads 13200 for 13200.0000, focused or not, and looking at it changes nothing', () => {
    const changes: string[] = [];
    render(<StoredBox initial="13200.0000" onChange={(value) => changes.push(value)} />);
    const box = screen.getByLabelText('price') as HTMLInputElement;
    expect(box.value).toBe('13200');
    fireEvent.focus(box);
    expect(box.value).toBe('13200');
    fireEvent.blur(box);
    expect(box.value).toBe('13200');
    expect(changes).toEqual([]);
  });

  it('never trims a figure while it is being typed (12.0 on the way to 12.05)', () => {
    const changes: string[] = [];
    render(<StoredBox initial="0.0000" onChange={(value) => changes.push(value)} />);
    const box = screen.getByLabelText('price') as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '12.0' } });
    expect(box.value).toBe('12.0');
    fireEvent.change(box, { target: { value: '12.05' } });
    expect(box.value).toBe('12.05');
    expect(changes).toEqual(['12.0', '12.05']);
    fireEvent.blur(box);
    expect(box.value).toBe('12.05');
  });

  it('keeps all four decimals it was given', () => {
    render(<StoredBox initial="0.1234" onChange={() => undefined} />);
    expect((screen.getByLabelText('price') as HTMLInputElement).value).toBe('0.1234');
  });
});
