import re, pathlib
mods=set()
for path in pathlib.Path('vendor/pokemon-showdown').rglob('*.ts'):
    for line in path.read_text(encoding='utf-8', errors='ignore').splitlines():
        m=re.match(r"\s*import .* from ['\"]([^'\"]+)['\"]", line)
        if m:
            target=m.group(1)
            if not target.startswith('.') and not target.startswith('node:'):
                mods.add(target.split('/')[0])
print('\n'.join(sorted(mods)))
