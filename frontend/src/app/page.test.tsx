import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("서비스 이름을 표시한다", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "한끗" })).toBeDefined();
  });
});
