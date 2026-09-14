import {
  MAX_COURSE_DENOMINATOR,
  formatPoolCourse,
  normalizePoolCourse,
  parsePoolCourse,
  swimErr,
  type PoolCourse,
  type PoolUnit,
  type SwimResult,
} from "./swimming";

export function parsePoolLengthInput(value: string, unit: PoolUnit): SwimResult<PoolCourse> {
  const text = value.trim();
  if (!text || text.length > 64) {
    return swimErr("course_invalid", "Enter a pool length, for example 25 or 33 1/3.");
  }
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  const decimal = /^(\d+)(?:\.(\d+))?$/.exec(text);
  let numerator: number;
  let denominator: number;
  if (mixed) {
    const whole = Number(mixed[1]);
    const remainder = Number(mixed[2]);
    denominator = Number(mixed[3]);
    if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(remainder) ||
        denominator === 0 || remainder >= denominator) {
      return swimErr("course_invalid", "Enter a pool length, for example 25 or 33 1/3.");
    }
    numerator = whole * denominator + remainder;
  } else if (fraction) {
    numerator = Number(fraction[1]);
    denominator = Number(fraction[2]);
  } else if (decimal) {
    const places = (decimal[2] ?? "").replace(/0+$/, "");
    denominator = 10 ** places.length;
    numerator = Number(`${decimal[1]}${places}`);
  } else {
    return swimErr("course_invalid", "Enter a pool length, for example 25 or 33 1/3.");
  }
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator > MAX_COURSE_DENOMINATOR) {
    return swimErr("course_not_representable", "Enter a shorter number or a simpler fraction for the pool length.");
  }
  return parsePoolCourse({
    lengthNumerator: numerator,
    lengthDenominator: denominator,
    unit,
  });
}

export function formatPoolLengthInput(course: PoolCourse): string {
  const normalized = normalizePoolCourse(course);
  if (!normalized.ok) throw new RangeError(normalized.error.message);
  const label = formatPoolCourse(normalized.value);
  return label.slice(0, -(normalized.value.unit.length + 1));
}
