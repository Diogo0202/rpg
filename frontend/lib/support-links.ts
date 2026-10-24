export function supportLinks(env: Record<string, string | undefined>) {
  return [
    { name: "Apoiar o projeto", value: env.DONATION_URL, hosts: null, affiliate: false },
    { name: "Livros oficiais na Amazon", value: env.AMAZON_BOOKS_URL, hosts: ["amazon.com", "amazon.com.br"], affiliate: true },
    { name: "Livros oficiais no DriveThruRPG", value: env.DRIVETHRURPG_BOOKS_URL, hosts: ["drivethrurpg.com"], affiliate: true },
  ].flatMap(({ name, value, hosts, affiliate }) => {
    if (!value?.trim()) return [];
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return [];
      if (hosts && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return [];
      return [{ name, href: url.toString(), affiliate }];
    } catch { return []; }
  });
}
