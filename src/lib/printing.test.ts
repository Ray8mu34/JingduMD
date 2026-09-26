import { completePrintJob } from "./printing";

it("keeps the prepared page until the native print operation finishes, even after a WebKit afterprint event", async () => {
  let finish!: () => void;
  const nativePrint = new Promise<void>((resolve) => { finish = resolve; });
  const restore = vi.fn();
  const job = completePrintJob(() => nativePrint, restore, true);
  window.dispatchEvent(new Event("afterprint"));
  expect(restore).not.toHaveBeenCalled();
  finish();
  await job;
  expect(restore).toHaveBeenCalledTimes(1);
});

it("restores exactly once when browser printing fires afterprint", async () => {
  const restore = vi.fn();
  await completePrintJob(() => window.dispatchEvent(new Event("afterprint")), restore, false);
  window.dispatchEvent(new Event("afterprint"));
  expect(restore).toHaveBeenCalledTimes(1);
});

it("restores after cancellation without leaving an afterprint listener", async () => {
  const restore = vi.fn();
  await completePrintJob(() => undefined, restore, false);
  window.dispatchEvent(new Event("afterprint"));
  expect(restore).toHaveBeenCalledTimes(1);
});

it("restores and propagates a failed native print command", async () => {
  const restore = vi.fn();
  await expect(completePrintJob(() => Promise.reject(new Error("closed")), restore, true)).rejects.toThrow("closed");
  expect(restore).toHaveBeenCalledTimes(1);
});
