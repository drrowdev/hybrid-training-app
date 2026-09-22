export function highStrainPowerBlocked(input: {
  highStrainTendon: boolean;
  power: boolean;
  tendinopathyActive: boolean;
}): boolean {
  return input.tendinopathyActive && input.power && input.highStrainTendon;
}
