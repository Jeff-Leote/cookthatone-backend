import { splitIntoWeeks } from './week-split';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const split = (start: string, end: string) =>
  splitIntoWeeks(new Date(start), new Date(end)).map(
    (week) => `${iso(week.start)}>${iso(week.end)}`,
  );

describe('splitIntoWeeks', () => {
  it('keeps a full week (Monday to Sunday) as a single week', () => {
    expect(split('2026-11-09', '2026-11-15')).toEqual([
      '2026-11-09>2026-11-15',
    ]);
  });

  it('keeps a single day as a single week', () => {
    expect(split('2026-11-11', '2026-11-11')).toEqual([
      '2026-11-11>2026-11-11',
    ]);
  });

  it('splits two full weeks', () => {
    expect(split('2026-11-09', '2026-11-22')).toEqual([
      '2026-11-09>2026-11-15',
      '2026-11-16>2026-11-22',
    ]);
  });

  it('truncates the first and last weeks to the period', () => {
    expect(split('2026-11-11', '2026-11-17')).toEqual([
      '2026-11-11>2026-11-15',
      '2026-11-16>2026-11-17',
    ]);
  });

  it('splits across a month and a year boundary', () => {
    expect(split('2026-12-28', '2027-01-10')).toEqual([
      '2026-12-28>2027-01-03',
      '2027-01-04>2027-01-10',
    ]);
  });

  it('starts a new week on Monday after a Sunday', () => {
    expect(split('2026-11-15', '2026-11-16')).toEqual([
      '2026-11-15>2026-11-15',
      '2026-11-16>2026-11-16',
    ]);
  });
});
