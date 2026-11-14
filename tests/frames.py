# v2d-36: analisi fotogrammi (lampo bianco + bocca/viso in movimento). Uso: frames.py DIR OUT.json
import sys, json, glob, os
from PIL import Image, ImageChops, ImageStat
d, out = sys.argv[1], sys.argv[2]
fs = sorted(glob.glob(os.path.join(d, 'f*.png')))
res = {'frames': len(fs), 'white': [], 'luma': [], 'diff': []}
prev = None
for f in fs:
    im = Image.open(f).convert('L')
    w, h = im.size
    st = ImageStat.Stat(im); m = st.mean[0]
    hist = im.histogram(); bright = sum(hist[236:]) / (w * h)
    res['luma'].append(round(m, 1))
    if m > 200 or bright > 0.6: res['white'].append(os.path.basename(f))
    face = im.crop((int(w * .25), int(h * .05), int(w * .75), int(h * .40)))
    if prev is not None:
        res['diff'].append(round(ImageStat.Stat(ImageChops.difference(face, prev)).mean[0], 2))
    prev = face
# fermo = fotogrammi consecutivi quasi identici nella zona del viso
run = best = 0
for x in res['diff']:
    run = run + 1 if x < 0.4 else 0; best = max(best, run)
res['longestStill'] = best
res['movingShare'] = round(sum(1 for x in res['diff'] if x >= 0.4) / max(1, len(res['diff'])), 3)
json.dump(res, open(out, 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k not in ('luma', 'diff')}))
