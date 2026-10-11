"""Package dist build artifacts only; never include private state or dependencies."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'dist/bridge'
version=json.loads((SOURCE/'package.json').read_text(encoding='utf8'))['version']
output=ROOT/'dist'/('ChatGPT-PC-Bridge-'+version+'-dev.zip')
files=[]
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for p in sorted(SOURCE.rglob('*')):
  if not p.is_file() or '__pycache__' in p.parts or p.suffix=='.pyc':continue
  name=p.relative_to(SOURCE).as_posix()
  assert not name.startswith(('data/','node_modules/','dist/'))
  info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
  archive.writestr(info,p.read_bytes());files.append(name)
with zipfile.ZipFile(output) as archive:assert archive.testzip() is None
sha=hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.zip.sha256').write_text(sha+'  '+output.name+'\n',encoding='ascii')
print(json.dumps({'package':str(output),'bytes':output.stat().st_size,'files':len(files),'sha256':sha,'zipCRC':True,'productionDeployed':False}))
