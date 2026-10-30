export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

export function parseModelRef(value: string): ModelRef {
  const invalid = () => {
    throw new Error(
      `invalid plugin option "model": expected "provider/model[#variant]", got ${JSON.stringify(value)}`,
    );
  };
  if (typeof value !== "string") invalid();

  const slash = value.indexOf("/");
  if (slash <= 0) invalid();
  const providerID = value.slice(0, slash);
  let rest = value.slice(slash + 1);

  let variant: string | undefined;
  const hash = rest.lastIndexOf("#");
  if (hash !== -1) {
    variant = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (variant === "") invalid();
  }
  if (rest === "") invalid();
  if (/\s/.test(providerID) || /\s/.test(rest) || (variant && /\s/.test(variant))) invalid();

  return variant === undefined ? { providerID, id: rest } : { providerID, id: rest, variant };
}
