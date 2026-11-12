import { describe, expect, it } from "vitest";
import { addAtom, attachGroup, emptyMol, fromMolfile, grow, molInfo, snapDir, toMolfile, valenceErrors, cycleBond, type Mol } from "./mol";
import { renderMol } from "./render";

function chain(n: number): Mol {
  let [m, id] = addAtom(emptyMol(), "C", 0, 0);
  for (let i = 1; i < n; i++) [m, id] = grow(m, id, snapDir(m, id, 0, false));
  return m;
}

describe("Strukturformel", () => {
  it("Butan als Zickzack-Kette mit 120°", () => {
    const m = chain(4);
    expect(molInfo(m)?.formula).toBe("C4H10");
    expect(molInfo(m)!.mass).toBeCloseTo(58.12, 1);
    const [a, b, c] = m.atoms;
    const t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(c.y - b.y, c.x - b.x);
    expect(Math.abs(t1 - t2)).toBeCloseTo(Math.PI / 3, 5); // 120° Bindungswinkel
    expect(Math.sign(b.y - a.y)).not.toBe(Math.sign(c.y - b.y));
  });

  it("Ethanol: –OH anhängen, Molfile hin und zurück, Halbstruktur", () => {
    let m = chain(2);
    [m] = attachGroup(m, m.atoms[1].id, "OH", true);
    expect(molInfo(m)?.formula).toBe("C2H6O");
    const back = fromMolfile(toMolfile(m));
    expect(molInfo(back)?.formula).toBe("C2H6O");
    const cond = renderMol(m, "condensed").svg;
    expect(cond).toContain("OH");
    const full = renderMol(m, "full").svg;
    expect((full.match(/>H</g) ?? []).length + (full.match(/>H<tspan/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("Valenzfehler und Bindung umschalten", () => {
    let m = chain(2);
    m = cycleBond(m, 0);
    expect(molInfo(m)?.formula).toBe("C2H4");
    m = cycleBond(cycleBond(m, 0), 0);
    expect(m.bonds[0].order).toBe(1);
    let [m2, o] = addAtom(emptyMol(), "O", 0, 0);
    for (let i = 0; i < 3; i++) [m2] = grow(m2, o, i * 2);
    expect(valenceErrors(m2).get(o)).toMatch(/Sauerstoff: 3 Bindungen/);
  });

  it("Benzolring und Carbonsäure", () => {
    let [m] = attachGroup(emptyMol(), null, "benzene", false);
    expect(molInfo(m)?.formula).toBe("C6H6");
    const c = chain(1);
    [m] = attachGroup(c, c.atoms[0].id, "COOH", false);
    expect(molInfo(m)?.formula).toBe("C2H4O2"); // Essigsäure
  });
});
