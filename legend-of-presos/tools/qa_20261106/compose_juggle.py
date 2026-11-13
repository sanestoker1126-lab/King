import json,sys
from PIL import Image,ImageDraw
root,trace,out=sys.argv[1:4]
fr=json.load(open(trace))
def loadchar(cid):
    d=json.load(open(f'{root}/assets/combat/{cid}/{cid}.char.json'))
    atl={};anc={}
    for k,a in d['atlases'].items():
        atl[k]=Image.open(f'{root}/assets/combat/{cid}/{a["file"]}').convert('RGBA')
        af=a.get('anchorsFile');anc[k]=json.load(open(f'{root}/assets/combat/{cid}/{af}'))['anchors'] if af else None
    return d,atl,anc
A=loadchar('el_paisa_sistem');O=loadchar('personaje_08')
def tex(ch,clipname,idx):
    d,atl,anc=ch;clip=d['clips'].get(clipname) or d['clips']['idle']
    gi=clip['frames'][min(idx,len(clip['frames'])-1)];ak=clip['atlas'];a=d['atlases'][ak]
    cw=(a.get('cell') or {}).get('w') or d['frameSize']['w'];chh=(a.get('cell') or {}).get('h') or d['frameSize']['h']
    cols=a['columns'];col,row=gi%cols,gi//cols
    im=atl[ak].crop((col*cw,row*chh,col*cw+cw,row*chh+chh))
    an=(anc[ak][gi] if anc[ak] and gi<len(anc[ak]) else a.get('anchor') or d['anchor'])
    return im,an,cw,chh
GROUND=480
def draw(cv,ch,st):
    im,an,cw,chh=tex(ch,st['clip'],st['idx']);scale=ch[0].get('renderScale',1.0)
    w=int(cw*scale);h=int(chh*scale);im2=im.resize((w,h),Image.LANCZOS)
    if st['face']<0:im2=im2.transpose(Image.FLIP_LEFT_RIGHT)
    ax=an['x'];ay=an['y']
    if st['face']<0:ax=1-ax
    px=int(st['x']-w*ax);py=int(GROUND-h*ay+(st['y']-GROUND))
    cv.alpha_composite(im2,(px,py))
bg=Image.open(f'{root}/assets/stages/guadalajara_oxxo_2.png').convert('RGBA').resize((1260,540))
picks=[(8,'UPPERCUT: lanza'),(25,'SÚPER en el AIRE'),(42,'sigue en el AIRE'),(58,'cae al suelo')]
tiles=[]
for t,label in picks:
    fd=next(x for x in fr if x['t']==t)
    cv=Image.new('RGBA',(960,540));cv.alpha_composite(bg,(-150,0))
    draw(cv,O,fd['o']);draw(cv,A,fd['a'])
    dd=ImageDraw.Draw(cv)
    tag=f"t={t}  {label}"+(f"   juggle x{fd['juggle']}" if fd['oAir'] and fd['juggle']>=2 else "")
    dd.rectangle((0,0,960,26),fill=(0,0,0,175));dd.text((8,6),tag,fill=(120,230,255,255))
    if fd['oAir'] and fd['juggle']>=2: dd.rectangle((2,2,958,538),outline=(90,200,255,255),width=4)
    tiles.append(cv.crop((120,90,840,540)).resize((460,288)))
W,H=tiles[0].size;strip=Image.new('RGBA',(W,H*len(tiles)),(18,18,22,255))
for i,t in enumerate(tiles):strip.alpha_composite(t,(0,i*H))
strip.convert('RGB').save(out,quality=88);print('ok',out)
