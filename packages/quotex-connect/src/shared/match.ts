export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function urlMatchesPattern(url: string, pattern: string): boolean {
  if (!url || !pattern) return false;
  try {
    return wildcardToRegExp(pattern).test(url);
  } catch {
    return false;
  }
}

export function recipeHasUsableSelectors(recipe: {
  selectors: { username: string; password: string; submit: string };
}): boolean {
  return Boolean(
    recipe.selectors.username.trim() &&
      recipe.selectors.password.trim() &&
      recipe.selectors.submit.trim()
  );
}
