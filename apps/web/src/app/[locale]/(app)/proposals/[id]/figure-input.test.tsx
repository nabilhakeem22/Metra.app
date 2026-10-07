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
