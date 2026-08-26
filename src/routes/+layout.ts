// The dashboard renders live broker state, so there is nothing useful to render
// on the server: every view would be stale before it reached the browser, and
// SSR would double every API call. The shell is served static and hydrates.
export const ssr = false;
export const prerender = false;
