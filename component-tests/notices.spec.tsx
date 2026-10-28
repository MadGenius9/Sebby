import { it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { NoticesPanel } from "../src/NoticesPanel";
afterEach(() => {
  cleanup();
  delete window.sebby;
});
it("loads fixed bundled notices on explicit click, rendering text not HTML", async () => {
  const read = vi.fn(
    async () => "<script>not executable</script>\nMIT fixture",
  );
  window.sebby = { thirdPartyNotices: read } as unknown as NonNullable<
    Window["sebby"]
  >;
  render(<NoticesPanel report={() => {}} />);
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(/MIT fixture/);
  expect(document.querySelector("script")).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});
it("browser preview does not pretend to read desktop packaged files", () => {
  render(<NoticesPanel report={() => {}} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
