/** CoC 7e figures derived from the eight characteristics. Age only adjusts movement. */

export type Characteristics = {
  str: number;
  con: number;
  siz: number;
  dex: number;
  app: number;
  int: number;
  pow: number;
  edu: number;
  luck: number;
};

export type Derived = {
  hp: number;
  mp: number;
  san: number;
  damage: string;
  build: number;
  mov: number;
};

/** CoC 7e rolls. STR, CON, DEX, APP, POW, and Luck are 3D6×5. SIZ, INT, and EDU are (2D6+6)×5. */
export function rollCharacteristics(random: () => number = Math.random): Characteristics {
  const die = () => 1 + Math.floor(random() * 6);
  const three = () => (die() + die() + die()) * 5;
  const size = () => (die() + die() + 6) * 5;
  return {
    str: three(),
    con: three(),
    siz: size(),
    dex: three(),
    app: three(),
    int: size(),
    pow: three(),
    edu: size(),
    luck: three(),
  };
}

export function hitPoints(con: number, siz: number): number {
  return Math.max(0, Math.floor((finite(con) + finite(siz)) / 10));
}

export function magicPoints(pow: number): number {
  return Math.max(0, Math.floor(finite(pow) / 5));
}

/** Damage bonus text and build from STR + SIZ. Bands follow the 7e table, then +1D6 / +1 build per 80. */
export function damageAndBuild(str: number, siz: number): { damage: string; build: number } {
  const total = finite(str) + finite(siz);
  if (total <= 64) return { damage: "-2", build: -2 };
  if (total <= 84) return { damage: "-1", build: -1 };
  if (total <= 124) return { damage: "0", build: 0 };
  if (total <= 164) return { damage: "+1D4", build: 1 };
  if (total <= 204) return { damage: "+1D6", build: 2 };
  const steps = Math.floor((total - 205) / 80);
  return { damage: `+${2 + steps}D6`, build: 3 + steps };
}

/** Base 8, 7 when both STR and DEX are below SIZ, 9 when both are above. From 40, −1 per 10 years, at least 1. */
export function movement(str: number, dex: number, siz: number, age: number | null): number {
  const strength = finite(str);
  const agility = finite(dex);
  const size = finite(siz);
  let mov = 8;
  if (strength < size && agility < size) mov = 7;
  else if (strength > size && agility > size) mov = 9;
  if (age != null && Number.isFinite(age) && age >= 40) {
    mov -= Math.min(5, Math.floor((age - 30) / 10));
  }
  return Math.max(1, mov);
}

export function derive(stats: Characteristics, age: number | null): Derived {
  const { damage, build } = damageAndBuild(stats.str, stats.siz);
  return {
    hp: hitPoints(stats.con, stats.siz),
    mp: magicPoints(stats.pow),
    san: Math.max(0, finite(stats.pow)),
    damage,
    build,
    mov: movement(stats.str, stats.dex, stats.siz, age),
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
