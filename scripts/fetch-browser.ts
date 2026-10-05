import {CamoufoxFetcher} from 'camoufox-js/dist/pkgman.js';
import {ALLOW_GEOIP,downloadMMDB} from 'camoufox-js/dist/locale.js';

// A cache eviction must not silently upgrade the browser.
class VerifiedFetcher extends CamoufoxFetcher {
  override checkAsset(asset:{name?:string;browser_download_url:string}) {
    if(asset.name!==`camoufox-152.0.4-beta.31-lin.${this.arch}.zip`)return null;
    return super.checkAsset(asset);
  }
}
requireLinux();
function requireLinux(){if(process.platform!=='linux')throw new Error('VERIFIED_RUNTIME_REQUIRES_LINUX');}
await new VerifiedFetcher().install();
if(ALLOW_GEOIP)await downloadMMDB();
