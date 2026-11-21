# -*- coding: utf-8 -*-
import io, re, sys, json
old, new = sys.argv[1], sys.argv[2]
def sub(path, a, b):
    s=io.open(path,encoding='utf-8').read()
    assert a in s, (path, a)
    io.open(path,'w',encoding='utf-8',newline='\n').write(s.replace(a,b,1))
sub('app/src-tauri/tauri.conf.json', f'"version": "{old}"', f'"version": "{new}"')
sub('app/package.json', f'"version": "{old}"', f'"version": "{new}"')
sub('app/src-tauri/Cargo.toml', f'version = "{old}"', f'version = "{new}"')
v=json.load(io.open('version.json',encoding='utf-8'))
v['version']=new
v['url']=f"https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v{new}/K4R.Neko.VPN_{new}_x64-setup.exe"
# описание в манифесте правим руками: автотекст врёт при каждой второй версии
if not v.get('notes'):
    v['notes'] = "Windows %s" % new
io.open('version.json','w',encoding='utf-8',newline='\n').write(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
print('bumped', old, '->', new)
