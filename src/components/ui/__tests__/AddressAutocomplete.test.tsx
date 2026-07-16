// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddressAutocomplete } from "../AddressAutocomplete";
import { searchAddresses } from "@/lib/addressSearch";

vi.mock("@/lib/addressSearch", () => ({
  fetchGooglePlaceDetails: vi.fn(),
  getActiveProvider: () => "nominatim",
  reverseGeocodeCurrentLocation: vi.fn(),
  searchAddresses: vi.fn(() => Promise.resolve([])),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AddressAutocomplete", () => {
  it("does not search a prefilled saved address when an edit form mounts", async () => {
    await act(async () => {
      root.render(
        <AddressAutocomplete
          value="901 McDonald Drive, Northville, MI 48167"
          onChange={() => {}}
          searchOnMount={false}
        />
      );
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(searchAddresses).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("does not show a no-results warning while the user is still typing", async () => {
    await act(async () => {
      root.render(<AddressAutocomplete value="90" onChange={() => {}} />);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(container.textContent).not.toContain("No verified address matches");
    expect(container.textContent).not.toContain("No matches");
    expect(container.textContent).not.toContain("No suggestions yet");
  });
});
