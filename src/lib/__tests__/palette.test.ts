import { describe, expect, it } from "vitest";
import { MIN_CONTRAST, PALETTE, avatarColor, chipColors, contrast } from "@/lib/palette";

// Includes the old hard-coded colors and awkward picks (yellow, white, black).
const SAMPLES = [...PALETTE, "#facc15", "#ffffff", "#000000", "#22d3ee", "#a3e635", "#64748b", "#f472b6"];

describe("palette contrast", () => {
  for (const hex of SAMPLES) {
    for (const theme of ["light", "dark"] as const) {
      it(`chip text on ${hex} (${theme}) reaches 4.5:1`, () => {
        const { bg, fg } = chipColors(hex, theme);
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      });
    }
  }

  it("avatar initials reach 4.5:1 for any name", () => {
    for (const name of ["Ada Admin", "Marta Nowak", "Tomek Wiśniewski", "Julia", "piotr", "", "Zoë"]) {
      expect(contrast("#ffffff", avatarColor(name))).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("contrast is symmetric and 21:1 for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
});
