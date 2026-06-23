process.env.NODE_ENV = "production";

const { validateServerEnv } = await import("../env.js");

const result = validateServerEnv();

console.log("QuoteX production environment check");
console.log("------------------------------------");

if (result.warnings.length > 0) {
  console.log("Warnings:");
  for (const warning of result.warnings) console.log(`- ${warning}`);
  console.log("");
}

if (!result.ok) {
  console.error("Blocking issues:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Production environment passes the fail-closed server checks.");

export {};
