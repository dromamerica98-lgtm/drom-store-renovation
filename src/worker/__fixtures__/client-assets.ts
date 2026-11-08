import type { EncodedAssets } from '../static';

/** Stand-in for the embedded web app in unit tests (vitest aliases virtual:client-assets here). */
const assets: EncodedAssets = {
  '/index.html': { b: btoa('<!doctype html><title>app</title>'), t: 'text/html; charset=utf-8', e: '"idx"', i: false },
  '/assets/index-abc.js': { b: btoa('console.log(1)'), t: 'text/javascript; charset=utf-8', e: '"js"', i: true },
};
export default assets;
