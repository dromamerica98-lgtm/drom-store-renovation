/** The built web app, embedded at deploy time by scripts/prepare-deploy.mjs. */
declare module 'virtual:client-assets' {
  const assets: import('./static').EncodedAssets;
  export default assets;
}
