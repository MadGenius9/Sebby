import test from "node:test";

// File symlinks require a Windows privilege that an ordinary desktop session
// may not have. Keep this visible as unavailable coverage, never a passing test.
export default function platformTest(name, fn) {
  return test(name, async (t) => {
    try {
      await fn(t);
    } catch (error) {
      if (
        process.platform === "win32" &&
        error.code === "EPERM" &&
        error.syscall === "symlink"
      ) {
        t.skip(
          "Windows session cannot create file symlinks; remaining assertions not run",
        );
        return;
      }
      throw error;
    }
  });
}
