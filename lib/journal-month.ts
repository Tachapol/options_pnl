export function isJournalMonth(value: unknown): value is string {
  return typeof value === "string" && /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
}

export function shiftJournalMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
