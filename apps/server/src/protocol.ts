/**
 * Re-export shim for the protocol package.
 *
 * Node's TypeScript type stripping is disabled inside `node_modules`, so the
 * workspace symlink cannot be used as a bare specifier at runtime. Importing
 * the sources through a relative path keeps both `node` and `tsc` happy.
 */
export * from '../../../packages/protocol/src/index.ts';
