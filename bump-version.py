"""Обновляет метку версии (?v=…) в index.html перед выкладкой: python bump-version.py"""
import re, pathlib, datetime

path = pathlib.Path(__file__).with_name('index.html')
html = path.read_text(encoding='utf-8')
old = re.search(r'\?v=([\w-]+)', html).group(1)
today = datetime.date.today().isoformat()
n = int(old.rsplit('-', 1)[1]) + 1 if old.startswith(today) else 1
new = f'{today}-{n}'
path.write_text(html.replace(f'?v={old}', f'?v={new}'), encoding='utf-8')
print(old, '->', new)
