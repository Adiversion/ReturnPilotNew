import base64
import os
import subprocess
import shutil
import tempfile

# Use exact crisp uploaded logo
logo_path = 'store-assets/logo.png'
logo_b64 = base64.b64encode(open(logo_path, 'rb').read()).decode('utf-8')
data_uri = f'data:image/png;base64,{logo_b64}'

# 1. Update screenshot-1.html
s1_path = 'store-assets/screenshot-1.html'
with open(s1_path, 'r', encoding='utf-8') as f:
    s1 = f.read()

s1 = s1.replace('__LOGO_DATA_URI__', data_uri)
with open(s1_path, 'w', encoding='utf-8') as f:
    f.write(s1)

# 2. Update screenshot-2.html
s2_path = 'store-assets/screenshot-2.html'
with open(s2_path, 'r', encoding='utf-8') as f:
    s2 = f.read()

s2 = s2.replace('__LOGO_DATA_URI__', data_uri)
with open(s2_path, 'w', encoding='utf-8') as f:
    f.write(s2)

# 3. Update screenshot-3.html
s3_path = 'store-assets/screenshot-3.html'
with open(s3_path, 'r', encoding='utf-8') as f:
    s3 = f.read()

s3 = s3.replace('__LOGO_DATA_URI__', data_uri)
with open(s3_path, 'w', encoding='utf-8') as f:
    f.write(s3)

# 4. Update screenshot-4.html
s4_path = 'store-assets/screenshot-4.html'
with open(s4_path, 'r', encoding='utf-8') as f:
    s4 = f.read()

s4 = s4.replace('__LOGO_DATA_URI__', data_uri)
with open(s4_path, 'w', encoding='utf-8') as f:
    f.write(s4)

print("Updated all HTML files with official ReturnPilot logo!")

# 5. Re-render all PNGs via headless Chrome
tdir = tempfile.mkdtemp()
chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
brain_dir = r'C:\Users\Anadi\.gemini\antigravity-cli\brain\f56a6670-dfd2-44f3-a194-05b17d32b8a7'

for i in range(1, 5):
    html_file = os.path.abspath(f'store-assets/screenshot-{i}.html')
    png_file = os.path.abspath(f'store-assets/screenshot-{i}.png')
    cmd = [chrome, '--headless=new', '--user-data-dir=' + tdir, f'--screenshot={png_file}', '--window-size=1280,800', '--default-background-color=00000000', html_file]
    subprocess.run(cmd, capture_output=True)
    if os.path.exists(png_file):
        shutil.copyfile(png_file, os.path.join(brain_dir, f'screenshot-{i}.png'))
        print(f'Rendered and synced screenshot-{i}.png with official logo ({os.path.getsize(png_file)} bytes)')
