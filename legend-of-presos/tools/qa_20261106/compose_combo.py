import json,sys
from PIL import Image,ImageDraw
root,trace,out=sys.argv[1:4]
fr=json.load(open(trace))
def loadchar(cid):
    d=json.load(open(f'{root}/assets/combat/{cid}/{cid}.char.json'))
    atl={}; anc={}
    for k,a in d['atlases'].items():
        atl[k]=Image.open(f'{root}/assets/combat/{cid}/{a["file"]}').convert('RGBA')
        af=a.get('anchorsFile')
        anc[k]=json.load(open(f'{root}/assets/combat/{cid}/{af}'))['anchors'] if af else None
    return d,atl,anc
A=loadchar('el_paisa_sistem'); O=loadchar('personaje_08')
def frame_tex(ch,clipname,idx):
    d,atl,anc=ch; clip=d['clips'].get(clipname) or d['clips']['idle']
    gi=clip['frames'][min(idx,len(clip['frames'])-1)]; ak=clip['atlas']; a=d['atlases'][ak]
    cw=(a.get('cell') or {}).get('w') or d['frameSize']['w']; chh=(a.get('cell') or {}).get('h') or d['frameSize']['h']
    cols=a['columns']; col,row=gi%cols,gi//cols
    im=atl[ak].crop((col*cw,row*chh,col*cw+cw,row*chh+chh))
    an=(anc[ak][gi] if anc[ak] and gi<len(anc[ak]) else a.get('anchor') or d['anchor'])
    return im,an,d.get('renderScale',1.0),cw,chh
GROUND=480; ARENA_W=960; TARGET=180
def draw(canvas,ch,st,flip=False):
    im,an,rs,cw,chh=frame_tex(ch,st['clip'],st['idx'])
    # escala a pantalla: renderScale * (TARGET/frameH no, usamos renderScale directo relativo a 180)
    scale=ch[0].get('renderScale',1.0)
    w=int(cw*scale); h=int(chh*scale)
    im2=im.resize((w,h),Image.LANCZOS)
    if st['face']<0: im2=im2.transpose(Image.FLIP_LEFT_RIGHT)
    ax=an['x']; ay=an['y']
    if st['face']<0: ax=1-ax
    px=int(st['x'] - w*ax); py=int(GROUND - h*ay + (st['y']-GROUND))
    canvas.alpha_composite(im2,(px,py))
# fondo
bg=Image.open(f'{root}/assets/stages/guadalajara_pemex_2.png').convert('RGBA').resize((ARENA_W+300,540))
picks=[(0,'arranca'),(5,'IMPACTO jab'),(14,'cancela a talón'),(23,'IMPACTO talón'),(30,'recup.')]
tiles=[]
for t,label in picks:
    fdat=next(x for x in fr if x['t']==t)
    cv=Image.new('RGBA',(ARENA_W,540)); cv.alpha_composite(bg,(-150,0))
    draw(cv,O,fdat['o']); draw(cv,A,fdat['a'])
    d=ImageDraw.Draw(cv)
    tag=f"t={t}  {label}"+(f"  combo x{fdat['combo']}" if fdat['combo']>=1 and 'IMPACTO' in label else '')
    d.rectangle((0,0,ARENA_W,26),fill=(0,0,0,170)); d.text((8,6),tag,fill=(255,230,120,255))
    if 'IMPACTO' in label:
        d.rectangle((2,2,ARENA_W-2,538),outline=(255,60,60,255),width=4)
    cv2=cv.crop((150,120,810,540)).resize((440,280))
    tiles.append(cv2)
W,H=tiles[0].size; strip=Image.new('RGBA',(W,H*len(tiles)),(20,20,24,255))
for i,t in enumerate(tiles): strip.alpha_composite(t,(0,i*H))
strip.convert('RGB').save(out,quality=88)
print('ok',out)
