// Monorepo-aware Metro config.
//
// In a pnpm workspace the app's deps and the shared @trailme/* packages live
// at the repo root, not under apps/mobile/node_modules. Metro must be told to
// (1) WATCH the whole repo (so edits to packages/* hot-reload), and
// (2) RESOLVE modules from both the app and the root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in packages/* trigger a reload.
config.watchFolders = [workspaceRoot];

// 2. Resolve from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm uses symlinks for workspace packages; let Metro follow them.
config.resolver.unstable_enableSymlinks = true;
// Don't hoist-deduplicate to a parent that the app can't reach.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
