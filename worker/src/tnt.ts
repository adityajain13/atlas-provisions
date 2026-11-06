// T&T prices are not fetched from the server: the site blocks automated lookups. The response shape lives in shared, so
// a browser sync that imports T&T prices reads the same normalised product.
export { normaliseTntItem, type TntProduct } from '@provisions/shared';
