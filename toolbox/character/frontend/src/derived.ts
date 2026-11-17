import { derive, type Characteristics } from "@ek/tool-api/coc";

/** Return a patch only: preserve Luck, Starting SAN, learned skills, and all other character data. */
export function investigatorDerived(person: Characteristics & { age: string }) {
  const age = person.age.trim() === "" ? null : Number(person.age);
  return derive(person, age != null && Number.isFinite(age) ? age : null);
}
