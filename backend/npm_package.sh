#/bin/sh
set -e

# Remove previous dist folder
rm -rf dist
# Build new dist folder
npm run build
# Remove previous package folder
rm -rf package
# Move JS and deps
mv dist package
cp -R node_modules package
# Remove symlink for rust-gbt and insert real folder
rm package/node_modules/rust-gbt
cp -R rust-gbt package/node_modules
# The native Arkade decoder is an external Node process, so its locked SDK
# dependencies must travel with the deployable artifact rather than dist alone.
(
  cd ../rust/arkade-codec
  npm ci --omit=dev --ignore-scripts
)
mkdir -p package/native/arkade-codec
cp ../rust/arkade-codec/codec.mjs ../rust/arkade-codec/package.json ../rust/arkade-codec/package-lock.json package/native/arkade-codec/
cp -R ../rust/arkade-codec/node_modules package/native/arkade-codec/
# Clean up deps
npm run package-rm-build-deps
