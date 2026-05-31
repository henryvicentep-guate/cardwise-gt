const shortDateFormatter = new Intl.DateTimeFormat('es-GT', {
  day: 'numeric',
  month: 'short'
});

export function formatShortDate(date: Date): string {
  return shortDateFormatter.format(date);
}
