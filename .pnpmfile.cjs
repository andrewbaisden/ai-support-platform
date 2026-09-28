// Published manifests need no devDependencies. For @issuerelay/widget they
// would otherwise name the private, bundled contracts package, which does
// not exist on npm. Applies to `pnpm pack` and `pnpm publish` only.
module.exports = {
  hooks: {
    beforePacking(manifest) {
      if (manifest.name === "@issuerelay/widget") {
        delete manifest.devDependencies;
      }
      return manifest;
    },
  },
};
