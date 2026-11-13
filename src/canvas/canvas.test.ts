import { describe, expect, it } from "vitest";
import { PalmRejection } from "./palm-rejection";
import { PointBuffer } from "./point-buffer";
import { FrameStats } from "./stats";
import { strokeOutline } from "./stroke";

describe("PalmRejection", () => {
  it("ignoriert Touch, während der Stift aufliegt", () => {
    const p = new PalmRejection();
    expect(p.onDown("pen", 1, 0)).toBe("draw");
    expect(p.onDown("touch", 2, 10)).toBe("ignore");
  });
  it("ignoriert Touch kurz nach Stiftnutzung, erlaubt ihn danach", () => {
    const p = new PalmRejection();
    p.onDown("pen", 1, 0);
    p.onUp("pen", 1, 100);
    expect(p.onDown("touch", 2, 500)).toBe("ignore");
    p.onUp("touch", 2, 510);
    expect(p.onDown("touch", 3, 4000)).toBe("draw");
  });
  it("Handballen bei aktivem Stift löst keine Geste aus und bleibt Handballen", () => {
    const p = new PalmRejection();
    p.onDown("pen", 1, 0);
    expect(p.onDown("touch", 2, 10)).toBe("ignore");
    expect(p.onDown("touch", 3, 20)).toBe("ignore");
    p.onUp("pen", 1, 30);
    // Stift längst weg, Hand liegt noch: weiterer Kontakt zählt nicht als Geste
    expect(p.onDown("touch", 4, 9000)).toBe("ignore");
    expect(p.isPalm(2)).toBe(true);
  });
  it("erkennt 2-Finger-Gesten ohne Stift", () => {
    const p = new PalmRejection();
    expect(p.onDown("touch", 2, 10)).toBe("draw");
    expect(p.onDown("touch", 3, 20)).toBe("gesture");
  });
  it("große Kontaktfläche gilt immer als Handballen", () => {
    expect(new PalmRejection().onDown("touch", 2, 0, 60)).toBe("ignore");
  });
  it("Stift übernimmt: laufende Finger werden zu Handballen", () => {
    const p = new PalmRejection();
    p.onDown("touch", 2, 0);
    p.demoteTouches();
    expect(p.isPalm(2)).toBe(true);
    expect(p.touchCount).toBe(0);
  });
  it("Maus zeichnet immer", () => {
    expect(new PalmRejection().onDown("mouse", 1, 0)).toBe("draw");
  });
});

describe("PointBuffer", () => {
  it("wächst ohne Datenverlust", () => {
    const b = new PointBuffer(2);
    for (let i = 0; i < 10; i++) b.push(i, i * 2, 0.5);
    expect(b.length).toBe(10);
    expect(b.toPoints()[9]).toEqual([9, 18, 0.5]);
    expect(b.snapshot().length).toBe(30);
  });
  it("hängt Vorhersagepunkte an", () => {
    const a = new PointBuffer();
    a.push(1, 1, 1);
    const p = new PointBuffer();
    p.push(2, 2, 1);
    expect(a.toPoints(p)).toHaveLength(2);
  });
});

describe("FrameStats", () => {
  it("berechnet FPS und Latenz", () => {
    const s = new FrameStats(1000);
    s.frame(1);
    for (let i = 1; i <= 60; i++) {
      s.latency(i % 2 ? 4 : 8);
      s.frame(1 + (i * 1000) / 60);
    }
    expect(Math.round(s.fps)).toBe(60);
    expect(s.latencyAvg).toBeCloseTo(6, 0);
    expect(s.latencyMax).toBe(8);
  });
});

describe("strokeOutline", () => {
  it("dünnere Linie bei weniger Druck", () => {
    const style = { color: "#000", size: 10, pressure: true };
    const line = (p: number) => [[0, 0, p], [50, 0, p], [100, 0, p]];
    const h = (o: number[][]) => Math.max(...o.map((q) => q[1])) - Math.min(...o.map((q) => q[1]));
    expect(h(strokeOutline(line(0.1), style, true))).toBeLessThan(h(strokeOutline(line(1), style, true)));
  });
});
