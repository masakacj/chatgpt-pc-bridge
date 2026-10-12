"""Determine the actual ID from the stable deployment path, using a disposable Profile."""
from pathlib import Path
import json,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
EXT=ROOT/'runtime/extension'
manifest=json.loads((EXT/'manifest.json').read_text())
with tempfile.TemporaryDirectory(prefix='bridge-id-') as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,args=['--disable-extensions-except='+str(EXT),'--load-extension='+str(EXT)],ignore_default_args=['--disable-extensions'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   extension_id=worker.url.split('/')[2]
   assert len(extension_id)==32
   print(json.dumps({'extensionId':extension_id,'path':str(EXT),'version':manifest['version'],'productionProfileTouched':False}))
  finally:context.close()
