import { describe, expect, it } from "vitest";
import { composeAddress, parseAddress } from "../AddressFields";

// =====================================================================
// Structured-fields composition / parsing.
// =====================================================================

describe("composeAddress", () => {
  it("composes street + city + state + zip", () => {
    expect(
      composeAddress({
        street: "901 McDonald Drive",
        apt: "",
        city: "Northville",
        state: "MI",
        zip: "48167",
      })
    ).toBe("901 McDonald Drive, Northville, MI 48167");
  });

  it("includes the apt/unit on the street line", () => {
    expect(
      composeAddress({
        street: "123 Main Street",
        apt: "Apt 4B",
        city: "Boston",
        state: "MA",
        zip: "02108",
      })
    ).toBe("123 Main Street Apt 4B, Boston, MA 02108");
  });

  it("trims whitespace and skips empty segments", () => {
    expect(
      composeAddress({ street: "  500 Oak Ave  ", apt: "", city: " Detroit ", state: "MI", zip: "48226" })
    ).toBe("500 Oak Ave, Detroit, MI 48226");
    expect(
      composeAddress({ street: "1 Apple Park Way", apt: "", city: "Cupertino", state: "", zip: "" })
    ).toBe("1 Apple Park Way, Cupertino");
  });
});

describe("parseAddress", () => {
  it("parses a canonical 'street, city, ST zip' string", () => {
    expect(parseAddress("901 McDonald Drive, Northville, MI 48167")).toEqual({
      street: "901 McDonald Drive",
      apt: "",
      city: "Northville",
      state: "MI",
      zip: "48167",
    });
  });

  it("splits an Apt/Unit suffix off the street", () => {
    expect(parseAddress("123 Main Street Apt 4B, Boston, MA 02108")).toEqual({
      street: "123 Main Street",
      apt: "Apt 4B",
      city: "Boston",
      state: "MA",
      zip: "02108",
    });
  });

  it("accepts ZIP+4", () => {
    expect(parseAddress("100 Park Avenue, New York, NY 10003-1234")).toEqual({
      street: "100 Park Avenue",
      apt: "",
      city: "New York",
      state: "NY",
      zip: "10003-1234",
    });
  });

  it("leaves unrecognised text in `street` rather than guessing", () => {
    expect(parseAddress("just a freeform string")).toEqual({
      street: "just a freeform string",
      apt: "",
      city: "",
      state: "",
      zip: "",
    });
  });

  it("composeAddress(parseAddress(x)) === x for canonical strings", () => {
    const canonical = [
      "901 McDonald Drive, Northville, MI 48167",
      "1600 Pennsylvania Avenue NW, Washington, DC 20500",
      "350 5th Avenue, New York, NY 10118",
      "1 Apple Park Way, Cupertino, CA 95014",
    ];
    for (const addr of canonical) {
      expect(composeAddress(parseAddress(addr))).toBe(addr);
    }
  });
});