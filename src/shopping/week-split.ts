const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface Week {
  start: Date;
  end: Date;
}

// Découpe une période en semaines du lundi au dimanche (dates UTC à minuit).
// Les extrémités sont tronquées à la période : du mercredi au mardi suivant
// donne mercredi-dimanche puis lundi-mardi.
export function splitIntoWeeks(periodStart: Date, periodEnd: Date): Week[] {
  const weeks: Week[] = [];
  let start = periodStart;
  while (start <= periodEnd) {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    const sunday = new Date(
      start.getTime() + (6 - daysSinceMonday) * MS_PER_DAY,
    );
    const end = sunday < periodEnd ? sunday : periodEnd;
    weeks.push({ start, end });
    start = new Date(end.getTime() + MS_PER_DAY);
  }
  return weeks;
}
