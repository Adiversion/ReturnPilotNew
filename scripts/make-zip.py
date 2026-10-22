import os
import sys
import shutil
import zipfile
import json

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_dir = os.path.join(root_dir, 'dist')

# Read version from root manifest.json
manifest_path = os.path.join(root_dir, 'manifest.json')
version = "4.0.3"
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest_data = json.load(f)
            version = manifest_data.get('version', version)
    except Exception as e:
        print(f"Notice: Could not parse manifest.json: {e}")

TARGETS = ['chrome', 'edge', 'firefox']

def create_zip(source_dir, output_zip_path):
    if os.path.exists(output_zip_path):
        os.remove(output_zip_path)
    
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for cur_root, dirs, files in os.walk(source_dir):
            if '_metadata' in cur_root:
                continue
            for file in files:
                if file.endswith('.zip') or file.startswith('.'):
                    continue
                full_path = os.path.join(cur_root, file)
                rel_path = os.path.relpath(full_path, source_dir).replace('\\', '/')
                zf.write(full_path, rel_path)

packaged = []

for target in TARGETS:
    target_dir = os.path.join(dist_dir, target)
    if os.path.exists(target_dir) and os.path.isdir(target_dir):
        target_version = version
        t_manifest = os.path.join(target_dir, 'manifest.json')
        if os.path.exists(t_manifest):
            try:
                with open(t_manifest, 'r', encoding='utf-8') as mf:
                    target_version = json.load(mf).get('version', version)
            except Exception:
                pass

        zip_name = f"ReturnPilot-v{target_version}-{target}.zip"
        zip_root = os.path.join(root_dir, zip_name)
        zip_dist = os.path.join(dist_dir, zip_name)
        
        create_zip(target_dir, zip_root)
        shutil.copyfile(zip_root, zip_dist)
        
        size_kb = os.path.getsize(zip_root) / 1024
        packaged.append((target, zip_name, size_kb))

        # Also provide base version alias if target version differs
        if target_version != version:
            alias_name = f"ReturnPilot-v{version}-{target}.zip"
            alias_root = os.path.join(root_dir, alias_name)
            alias_dist = os.path.join(dist_dir, alias_name)
            shutil.copyfile(zip_root, alias_root)
            shutil.copyfile(zip_root, alias_dist)

# Backwards compatibility: create ReturnPilot-v{version}-production.zip from chrome build
chrome_zip = os.path.join(root_dir, f"ReturnPilot-v{version}-chrome.zip")
legacy_zip_root = os.path.join(root_dir, f"ReturnPilot-v{version}-production.zip")
legacy_zip_dist = os.path.join(dist_dir, f"ReturnPilot-v{version}-production.zip")

if os.path.exists(chrome_zip):
    shutil.copyfile(chrome_zip, legacy_zip_root)
    shutil.copyfile(chrome_zip, legacy_zip_dist)

print("Release packages generated:")
for target, name, size in packaged:
    print(f"  + [{target.upper():7}] {name} ({size:.1f} KB)")
if os.path.exists(legacy_zip_root):
    print(f"  + [LEGACY ] ReturnPilot-v{version}-production.zip ({os.path.getsize(legacy_zip_root)/1024:.1f} KB)")
