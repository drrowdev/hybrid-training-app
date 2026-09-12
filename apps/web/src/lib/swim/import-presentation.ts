const distanceFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatImportedSwimDistance(metres: number): string {
  return `${distanceFormat.format(metres)} m`;
}
