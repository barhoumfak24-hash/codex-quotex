type VinFieldDescriptor = {
  key?: string;
  id?: string;
  label?: string;
};

function compactVinFieldText(value: string | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function uppercaseVinInput(value: string): string {
  return value.toUpperCase();
}

export function isVinInputField(field: VinFieldDescriptor): boolean {
  const key = compactVinFieldText(field.key);
  const id = compactVinFieldText(field.id);
  const label = String(field.label ?? "").trim().toLowerCase();
  const compactLabel = compactVinFieldText(label);

  if (["vin", "vinnumber", "vehiclevin", "vehiclevinnumber"].includes(key)) return true;
  if (["vin", "vinnumber", "vehiclevin", "vehiclevinnumber"].includes(id)) return true;
  if (["vin", "vin number", "vehicle vin", "vehicle vin number"].includes(label)) return true;
  if (/^vin\s*\(/i.test(label)) return true;
  return compactLabel === "vehicleidentificationnumber";
}

export function normalizeVinFieldValue(field: VinFieldDescriptor, value: string): string {
  return isVinInputField(field) ? uppercaseVinInput(value) : value;
}
