import { test, expect } from "@playwright/test";
test("honest offline chat and playbooks", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What shall we build?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send unavailable: AI not connected" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Plan an app", exact: true }).click();
  await expect(page.locator("#draft")).toContainText("");
  await expect(page.locator("#draft")).toHaveValue(/App planning playbook/);
});
test("memory persists on reload", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Memory", exact: true })
    .click();
  await page.locator("#memory").fill("A local regression-test memory");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Memory", exact: true })
    .click();
  await expect(page.locator("#memory")).toHaveValue(
    "A local regression-test memory",
  );
});
test("connections are explicit and mobile does not overflow", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(3);
  await page
    .getByRole("button", { name: "Choose workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("desktop app");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
