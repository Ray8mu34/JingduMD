import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ResizableSidebar from "./ResizableSidebar";

afterEach(cleanup);

function setup(side: "left" | "right" = "right") {
  const onResize = vi.fn();
  function Harness() {
    const [width, setWidth] = useState(230);
    return <ResizableSidebar side={side} width={width} maxWidth={420} overlay={false}
      onResize={(next) => { onResize(next); setWidth(next); }}>Content</ResizableSidebar>;
  }
  const { getByRole } = render(<Harness />);
  const handle = getByRole("separator");
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  handle.releasePointerCapture = vi.fn();
  const pointer = (type: string, clientX: number, pointerId = 1) => {
    const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    fireEvent(handle, event);
  };
  return { handle, pointer, onResize };
}

describe("ResizableSidebar drag completion", () => {
  it.each(["left", "right"] as const)("commits the final %s coordinate when the last move is missing", (side) => {
    const { handle, pointer } = setup(side);
    const direction = side === "left" ? 1 : -1;
    pointer("pointerdown", 500);
    pointer("pointermove", 500 + 64 * direction);
    expect(handle).toHaveAttribute("aria-valuenow", "294");
    pointer("pointerup", 500 + 70 * direction);
    expect(handle).toHaveAttribute("aria-valuenow", "300");
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(document.documentElement).not.toHaveClass("resizing-sidebar");
    pointer("pointermove", 500 + 90 * direction);
    expect(handle).toHaveAttribute("aria-valuenow", "300");
  });

  it.each([[0, "420"], [1000, "160"]])("clamps a release without any move at %s", (x, expected) => {
    const { handle, pointer } = setup();
    pointer("pointerdown", 500);
    pointer("pointerup", Number(x));
    expect(handle).toHaveAttribute("aria-valuenow", expected);
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("does not commit coordinates on %s", (type) => {
    const { handle, pointer, onResize } = setup();
    pointer("pointerdown", 500);
    pointer("pointermove", 436);
    onResize.mockClear();
    if (type === "blur") fireEvent(window, new Event("blur"));
    else pointer(type, 0);
    pointer("pointerup", 430);
    expect(handle).toHaveAttribute("aria-valuenow", "294");
    expect(onResize).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass("resizing-sidebar");
  });

  it("ignores release from a different pointer", () => {
    const { handle, pointer, onResize } = setup();
    pointer("pointerdown", 500);
    pointer("pointerup", 0, 2);
    expect(onResize).not.toHaveBeenCalled();
    expect(handle).toHaveClass("is-dragging");
    pointer("pointerup", 430);
    expect(handle).toHaveAttribute("aria-valuenow", "300");
  });
});
