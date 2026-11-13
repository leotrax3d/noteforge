import { describe, expect, it } from "vitest";
import { suggestSubjectFor } from "./integrations";

const S = (name: string) => ({ name });
describe("suggestSubjectFor", () => {
  it("findet über Lang- und Kurznamen", () => {
    const subs = [S("Mathe"), S("Deutsch"), S("Physik"), S("Politik")];
    expect(suggestSubjectFor({ id: 1, name: "M", longName: "Mathematik" }, subs)?.name).toBe("Mathe");
    expect(suggestSubjectFor({ id: 2, name: "D", longName: "" }, subs)?.name).toBe("Deutsch");
    expect(suggestSubjectFor({ id: 3, name: "PH", longName: "" }, subs)?.name).toBe("Physik");
  });
  it("schlägt bei Mehrdeutigkeit nichts vor", () => {
    expect(suggestSubjectFor({ id: 4, name: "P", longName: "" }, [S("Physik"), S("Politik")])).toBeNull();
    expect(suggestSubjectFor({ id: 5, name: "SPO", longName: "Sport" }, [S("Musik")])).toBeNull();
  });
});
