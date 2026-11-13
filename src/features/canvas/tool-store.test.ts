import { describe, expect, it } from "vitest";
import { useTools } from "./tool-store";

describe("Greifen als Standard", () => {
  it("startet mit Greifen und merkt sich das Stift-Werkzeug", () => {
    expect(useTools.getState().tool).toBe("pan");
    useTools.getState().setTool("eraser");
    expect(useTools.getState().penTool).toBe("eraser");
    useTools.getState().setTool("pan");
    expect(useTools.getState().penTool).toBe("eraser");
    useTools.getState().setTool("text");
    expect(useTools.getState().penTool).toBe("eraser");
    useTools.getState().setPen("pencil");
    expect(useTools.getState().penTool).toBe("pen");
  });
});
