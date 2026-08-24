/**
 * A very small router.
 *
 * Six endpoints do not justify a framework, and the pieces a framework would
 * bring — routing and body parsing — are the parts of this server with the
 * least security surface. What actually matters (parameterised SQL, token
 * hashing, rate limiting, validation) a framework would not have done for us.
 * See docs/decisions.md.
 */

export function createRouter() {
  const routes = [];

  return {
    add(method, path, handler) {
      routes.push({ method, path, handler });
      return this;
    },
    get(path, handler) {
      return this.add('GET', path, handler);
    },
    post(path, handler) {
      return this.add('POST', path, handler);
    },
    match(method, pathname) {
      return routes.find(
        (route) => route.method === method && route.path === pathname,
      ) ?? null;
    },
    /** Whether any route exists at this path, for 404 vs 405. */
    hasPath(pathname) {
      return routes.some((route) => route.path === pathname);
    },
  };
}
