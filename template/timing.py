import json,re,sys,subprocess,difflib,wave,os
import numpy as np, soundfile as sf
# Usage: python3 timing.py <day-dir> [lead-seconds]   (needs voice.mp3, script.json; writes timing.json and voice.wav)
day=sys.argv[1]; LEAD=float(sys.argv[2]) if len(sys.argv)>2 else 0.2
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',day+'/voice.mp3','-ac','1','-ar','16000','-sample_fmt','s16',day+'/_v16.wav'],check=True)
from pocketsphinx import Decoder
d=Decoder(loglevel='FATAL'); d.start_utt()
raw=open(day+'/_v16.wav','rb').read()[44:]
d.process_raw(raw,False,True); d.end_utt()
heard=[(s.word,s.start_frame/100,s.end_frame/100) for s in d.seg() if not s.word.startswith('<') and s.word not in('[SPEECH]','[NOISE]') and not s.word.startswith('++')]
heard=[(re.sub(r'\(\d+\)','',w),a,b) for w,a,b in heard]
sc=json.load(open(day+'/script.json'))
def toks(t):
    out=[]
    for m in re.finditer(r'\{([^|}]*)\|([^}]*)\}|(\S+)',t):
        if m.group(3): out.append((m.group(3),m.group(3)))
        else: out.append((m.group(1),m.group(2)))
    # split spoken multiword into pieces
    res=[]
    for sh,sp in out:
        parts=re.sub(r'[^\w\' ]',' ',sp.replace('&',' and ')).lower().split()
        res.append((sh,parts))
    return res
T=[toks(s['text']) for s in sc['scenes']]
flat=[(i,j,p) for i,t in enumerate(T) for j,(sh,ps) in enumerate(t) for p in ps]
a=[f[2] for f in flat]; b=[h[0].lower() for h in heard]
sm=difflib.SequenceMatcher(None,a,b,autojunk=False)
tm=[None]*len(a)
for tag,i1,i2,j1,j2 in sm.get_opcodes():
    if tag=='equal':
        for k in range(i2-i1): tm[i1+k]=(heard[j1+k][1],heard[j1+k][2])
print('matched',sum(x is not None for x in tm),'of',len(a))
dur=sf.info(day+'/voice.mp3').duration
# fill gaps linearly
idx=[k for k,x in enumerate(tm) if x]
for k in range(len(tm)):
    if tm[k] is None:
        l=max([i for i in idx if i<k],default=None); r=min([i for i in idx if i>k],default=None)
        t0=tm[l][1] if l is not None else 0.1; t1=tm[r][0] if r is not None else dur-0.1
        lo=l if l is not None else -1; hi=r if r is not None else len(tm)
        n=hi-lo-1; pos=k-lo-1
        tm[k]=(t0+(t1-t0)*pos/n, t0+(t1-t0)*(pos+1)/n)
words=[[] for _ in T]
for (i,j,p),(s0,s1) in zip(flat,tm):
    words[i].append((j,s0,s1))
timing={'scenes':[]}
firsts=[]
for i,t in enumerate(T):
    per={}
    for j,s0,s1 in words[i]: per.setdefault(j,[s0,s1]); per[j][1]=s1; per[j][0]=min(per[j][0],s0)
    ws=[{'w':T[i][j][0],'t0':round(per[j][0]+LEAD,3),'t1':round(max(per[j][1],per[j][0]+.1)+LEAD,3)} for j in sorted(per)]
    timing['scenes'].append({'id':sc['scenes'][i]['id'],'words':ws})
S=timing['scenes']
for i,s in enumerate(S):
    s['t0']=LEAD if i==0 else round((S[i-1]['words'][-1]['t1']+s['words'][0]['t0'])/2,3)
for i,s in enumerate(S):
    s['t1']=S[i+1]['t0'] if i<len(S)-1 else round(s['words'][-1]['t1']+0.9,3)
timing['duration']=round(S[-1]['t1']+0.6,3)
json.dump(timing,open(day+'/timing.json','w'),indent=1)
a_,sr=sf.read(day+'/voice.mp3')
if a_.ndim>1:a_=a_.mean(1)
out=np.concatenate([np.zeros(int(LEAD*sr)),a_,np.zeros(int(2.5*sr))]); sf.write(day+'/voice.wav',out,sr)
for s in S: print(s['id'],s['t0'],s['t1'],[(w['w'],w['t0']) for w in s['words']][:4])
print('dur',timing['duration'])
os.remove(day+'/_v16.wav')
